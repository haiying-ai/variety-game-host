-- ============================================================
-- 综艺游戏王 · 上线加固迁移（2026-11-02）
-- 目标：唯一约束防重复入库、入库逻辑下沉数据库（幂等+毒丸免疫）、
--       锁释放原子化、RLS 收紧（正式表对客户端只读）
-- ============================================================

-- 1. sync_state 增加可观测性字段
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_result text;
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_error text;

-- 2. remote_feed 增加失败标记字段
ALTER TABLE remote_feed ADD COLUMN IF NOT EXISTS ingest_error text;

-- 3. 唯一约束（幂等去重的最后防线）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'episodes_uniq_ep') THEN
    ALTER TABLE episodes ADD CONSTRAINT episodes_uniq_ep UNIQUE (show_id, season, episode_no);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_uniq_ep_name') THEN
    ALTER TABLE games ADD CONSTRAINT games_uniq_ep_name UNIQUE (episode_id, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remote_feed_uniq_ep') THEN
    ALTER TABLE remote_feed ADD CONSTRAINT remote_feed_uniq_ep UNIQUE (show_name, season, episode_no);
  END IF;
END;
$$;

-- 4. 单条 feed 原子入库（SECURITY DEFINER，绕过 RLS）
--    - 一条 feed 记录 = 一个事务：中途崩溃自动回滚，不会出现"插了一半"
--    - 幂等：重复调用返回 already / 按唯一约束跳过，绝不重复插入
--    - 毒丸免疫：单条坏数据由客户端调 mark_feed_failed 标记跳过，不阻塞队列
--    - 标签校验（原客户端 sanitizeTags 下沉）：只留 6 个合法标签、场地/坐玩互斥、身份类必带狼人杀
CREATE OR REPLACE FUNCTION public.ingest_feed_row(p_row_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row remote_feed%ROWTYPE;
  v_show_id bigint;
  v_ep_id bigint;
  v_created_ep boolean := false;
  v_g jsonb;
  v_tags text[];
  v_pool jsonb;
  v_is_identity boolean;
  v_inserted int := 0;
  v_skipped int := 0;
BEGIN
  SELECT * INTO v_row FROM remote_feed WHERE id = p_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  IF v_row.ingested THEN
    RETURN jsonb_build_object('status', 'already');
  END IF;
  IF v_row.payload IS NULL OR jsonb_typeof(v_row.payload) <> 'array' OR jsonb_array_length(v_row.payload) = 0 THEN
    UPDATE remote_feed SET ingested = true, ingest_error = 'payload为空或不是数组' WHERE id = p_row_id;
    RETURN jsonb_build_object('status', 'empty');
  END IF;

  SELECT id INTO v_show_id FROM shows WHERE name = v_row.show_name;
  IF v_show_id IS NULL THEN
    INSERT INTO shows(name, emoji, description) VALUES (v_row.show_name, '🎬', '最新更新')
    RETURNING id INTO v_show_id;
  END IF;

  SELECT id INTO v_ep_id FROM episodes
  WHERE show_id = v_show_id AND season = v_row.season AND episode_no = v_row.episode_no;
  IF v_ep_id IS NULL THEN
    INSERT INTO episodes(show_id, season, episode_no, title, aired_on)
    VALUES (v_show_id, v_row.season, v_row.episode_no,
            COALESCE(v_row.title, '第' || v_row.episode_no || '期'), v_row.aired_on)
    RETURNING id INTO v_ep_id;
    v_created_ep := true;
  END IF;

  FOR v_g IN SELECT * FROM jsonb_array_elements(v_row.payload) LOOP
    IF v_g->>'name' IS NULL OR btrim(v_g->>'name') = ''
       OR btrim(COALESCE(v_g->>'rules', '')) = '' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM games WHERE episode_id = v_ep_id AND name = v_g->>'name') THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_tags := ARRAY(SELECT t FROM jsonb_array_elements_text(COALESCE(v_g->'tags', '[]'::jsonb)) t
                    WHERE t IN ('分组','场地','坐玩','动作','狼人杀','积分'));
    IF '场地' = ANY(v_tags) AND '坐玩' = ANY(v_tags) THEN
      v_tags := array_remove(v_tags, '坐玩');
    END IF;
    v_pool := COALESCE(v_g->'word_pool', '{}'::jsonb);
    v_is_identity := (COALESCE(v_pool->>'hint', '') LIKE '%角色%')
      OR (jsonb_typeof(v_pool->'signals') = 'array' AND jsonb_array_length(v_pool->'signals') > 0)
      OR (v_pool ? 'boss');
    IF v_is_identity AND NOT ('狼人杀' = ANY(v_tags)) THEN
      v_tags := array_append(v_tags, '狼人杀');
    END IF;

    INSERT INTO games(episode_id, name, play_style, rules, tags, min_players, max_players, need_props, word_pool, scene)
    VALUES (
      v_ep_id,
      btrim(v_g->>'name'),
      COALESCE(v_g->>'play_style', ''),
      replace(COALESCE(v_g->>'rules', ''), E'\\n', chr(10)),
      v_tags,
      CASE WHEN COALESCE(v_g->>'min_players', '') ~ '^[0-9]+$' THEN (v_g->>'min_players')::int ELSE 2 END,
      CASE WHEN COALESCE(v_g->>'max_players', '') ~ '^[0-9]+$' THEN (v_g->>'max_players')::int ELSE 20 END,
      COALESCE(v_g->>'need_props', '无'),
      v_pool,
      COALESCE(v_g->>'scene', '')
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE remote_feed SET ingested = true, ingest_error = NULL WHERE id = p_row_id;
  RETURN jsonb_build_object('status', 'ok', 'games', v_inserted, 'skipped', v_skipped,
                            'episode_created', v_created_ep, 'episode_id', v_ep_id);
END;
$$;

-- 5. 毒丸标记：单条坏数据标记跳过，永不阻塞队列
CREATE OR REPLACE FUNCTION public.mark_feed_failed(p_row_id bigint, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE remote_feed SET ingested = true, ingest_error = left(p_error, 500) WHERE id = p_row_id;
END;
$$;

-- 6. 原子释放锁：last_sync_at 更新 + data_version 原子自增 + 结果留痕，一步完成
CREATE OR REPLACE FUNCTION public.release_sync(p_owner text, p_bumped boolean, p_result text, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE sync_state
  SET lock_owner = NULL,
      lock_at = NULL,
      last_sync_at = now(),
      last_result = p_result,
      last_error = p_error,
      data_version = CASE WHEN p_bumped THEN data_version + 1 ELSE data_version END
  WHERE id = 'global' AND lock_owner = p_owner;
END;
$$;

-- 7. RLS 收紧：正式数据表对客户端只读，写操作只走上面的 SECURITY DEFINER 函数
--    （数据供给方走管理员通道写 remote_feed，不受 RLS 限制）
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS shows_all ON shows';
  EXECUTE 'CREATE POLICY shows_read ON shows FOR SELECT TO anon, authenticated USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS episodes_all ON episodes';
  EXECUTE 'CREATE POLICY episodes_read ON episodes FOR SELECT TO anon, authenticated USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS games_all ON games';
  EXECUTE 'CREATE POLICY games_read ON games FOR SELECT TO anon, authenticated USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS sync_state_all ON sync_state';
  EXECUTE 'CREATE POLICY sync_state_read ON sync_state FOR SELECT TO anon, authenticated USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS remote_feed_all ON remote_feed';
  EXECUTE 'CREATE POLICY remote_feed_read ON remote_feed FOR SELECT TO anon, authenticated USING (true)';
END;
$$;

INSERT INTO shows (name, emoji, description) VALUES
 ('现在就出发','🚌','跟着综艺去旅行的游戏合集'),
 ('奔跑吧','🏃','户外奔跑竞技游戏'),
 ('王牌对王牌','🃏','棚内传声筒和猜词游戏'),
 ('萌探探探案','🕵️','推理扮演类游戏')
ON CONFLICT (name) DO NOTHING;

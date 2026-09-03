-- 启用 pg_trgm 扩展：为后续别名/模糊匹配（词条消歧义、红链联想）打底
CREATE EXTENSION IF NOT EXISTS pg_trgm;

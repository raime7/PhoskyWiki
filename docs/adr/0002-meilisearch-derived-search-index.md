# 0002 - Meilisearch 作为派生搜索索引

站内搜索由独立的 Meilisearch 实例提供服务，数据是从 PostgreSQL 同步出来的派生索引。ADR-0001 的"PostgreSQL 是唯一内容存储"指的是内容的 source of truth；搜索索引是随时可从 PG 全量重建的可丢数据，不构成第二内容存储。

选 Meilisearch 而非 PG zhparser 的理由：中文分词、搜索联想（instant search）、分面过滤开箱即用，萌百式即打即搜是硬需求；zhparser 的相关性排序和联想体验明显更弱，且扩展镜像需要自行维护。代价：多一个容器，以及一个同步任务（由提交/受理事件驱动增量同步 + 定期全量校对兜底）。

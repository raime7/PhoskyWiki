import "dotenv/config";
import { assertIsolatedTestEnvironment } from "./isolated-environment";

assertIsolatedTestEnvironment();

// 主缝测试不打网络（spec Testing Decisions）：搜索索引用注入的 fake（tests 里
// injectSearchIndex），这里抹掉 MEILI_HOST 让默认实现降级为 null；
// 唯一打真 Meilisearch 的是契约测试 search-meili.contract.test.ts——
// 它自备连接参数、绕过注册表，不受本行影响。
process.env.MEILI_HOST = "";

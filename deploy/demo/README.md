# 只读演示的 NGINX 配置

`nginx.conf.template` 只用于公开的固定快照演示：外部 `8123` → `127.0.0.1:8001`。不要把此缓存例外用于正常客户端或实时采集服务。

- JS、CSS、JSON 和 SVG 开启 gzip；哈希静态资源缓存一年。
- 将每次构建的 `packages/cli/dist/dashboard/assets/` 追加到 `/opt/quotern-demo/public/assets/`，目录和文件须允许 NGINX 读取。同名哈希必须对应相同内容；保留旧文件支持已经打开的页面。不存在的资源返回 404，不回退到 HTML。
- 仅缓存 `/functions/` 下 GET/HEAD 的 HTTP 200 响应，完整 Host（含端口）、Origin 和 URI（含筛选参数）参与键，保留会话接口的来源校验。写请求继续到上游拒绝，403/503 等不写缓存。上游 `Set-Cookie`、`Vary` 的默认保护仍生效。
- API 对浏览器继续返回 `no-store`；NGINX 在本演示站点内部显式覆盖该缓存禁令，命中状态见 `X-Demo-Cache: MISS/HIT/BYPASS`。第一次查询仍需要聚合，可在切换后预热常用范围。
- 将 `__CACHE_VERSION__` 替换为部署提交与快照 SHA-256 的组合，每次更新任一项都必须更换。NGINX reload 本身不会清除旧缓存；版本键隔离旧结果。换快照时先停止服务，安装快照及匹配的新配置，再启动服务、重载 NGINX、预热。
- 缓存最多 256 MB，成功结果有效 24 小时；这只影响固定演示结果，不代表实时观测时间。只读页面自动轮询及 focus/visibility 刷新关闭，初载、筛选和显式刷新保留。

配置安装到 `/etc/nginx/conf.d/quotern-demo.conf`（由主配置的 `http` 块 include）。先备份现有配置，创建 `/var/cache/nginx/quotern-demo` 并赋予 NGINX 用户读写权限，执行 `nginx -t` 成功后才 reload。保留前一版本服务路径与配置便于回滚。部署后至少检查：压缩响应、静态缓存头、缺失资源 404、API MISS→HIT、不同筛选不混用、写入 403、额度不可用 503 不缓存，以及快照哈希未变化。

# 从头配置 LiveSync，CouchDB 和 SSL

> 本文所有操作在 Debain 10 上由 root 用户执行。
> 需要使用 SSH 客户端连接 VPS；会 vim 或其他编辑器的基本操作。

## 安装 CouchDB

1. 启用 Apache CouchDB 包存储库（要执行两次，原因暂未知）
```bash
apt -y update && apt install sudo && sudo apt install -y curl apt-transport-https gnupg
curl https://couchdb.apache.org/repo/keys.asc | gpg --dearmor | sudo tee /usr/share/keyrings/couchdb-archive-keyring.gpg >/dev/null 2>&1
source /etc/os-release
echo "deb [signed-by=/usr/share/keyrings/couchdb-archive-keyring.gpg] https://apache.jfrog.io/artifactory/couchdb-deb/ ${VERSION_CODENAME} main" \
    | sudo tee /etc/apt/sources.list.d/couchdb.list >/dev/null
```
2. 安装 Apache CouchDB 包
```bash
apt update
apt install -y couchdb
```

### 安装过程

1. 选择 "standalone"，即独立安装，指在单个服务器上安装。
2. 设置 Erlang Magic Cookie。这是为集群进行身份验证的唯一标识符，所有节点必须具有相同的 cookie。这里先写 "monkey"。
3.  网络绑定接口，选择安装路线：
	- 绑定到 127.0.0.1（localhost）以私有访问（==推荐！==），配合 Nginx 代理使用。转到：
	   <<[[#Nginx 配置 SSL 与绑定子域名]]>>
	- 绑定到 0.0.0.0，安装后所有地址都可访问，即使配置了 ssl，5984 端口依然处于公开访问状态。转到：
	   <<[[#配置 SSL - 与 Nginx 配置 SSL 二选一]]>>
4. 管理员密码。通过 WebUI 访问 CouchDB 时将使用的密码。设为 "your_password"，账号为 "admin"。
- ~~使用系统服务来验证 CouchDB 守护进程（daemon）是否正在运行~~
```bash
sudo systemctl status couchdb
```

## 配置 SSL - 推荐使用 Nginx 配置 SSL

1. 通过 openssl 申请自签名证书
```bash
mkdir /etc/couchdb/cert
cd /etc/couchdb/cert
openssl genrsa > privkey.pem
openssl req -new -x509 -key privkey.pem -out couchdb.pem -days 1095
```
- 输入申请信息：输入一个句点“.”，该字段将被视为留空（~~邮箱可直接留空~~）
```bash
chmod 600 privkey.pem couchdb.pem
chown couchdb privkey.pem couchdb.pem
```
2. 查找并配置 `local.ini` 文件
```bash
find / -name local.ini
vi /opt/couchdb/etc/local.ini
```

```erlang
[ssl]
enable = true
cert_file = /etc/couchdb/cert/couchdb.pem
key_file = /etc/couchdb/cert/privkey.pem
```
3. 重启 CouchDB
```bash
systemctl restart couchdb
```
4. 忽略自签名提示进行 HTTPS 连接
```bash
curl -k https://127.0.0.1:6984/
```
- 出现以下样式的信息，表示成功
```bash
{"couchdb":"Welcome","version":"3.3.1"}
```
- 浏览器访问：
```
https://yoursite.com:6984/_utils/
```
- 到这一步，5984 端口处于公开访问状态。

## Nginx 配置 SSL 与绑定子域名

### Certbot 申请官方证书

1. 安装 Certbot
```bash
apt install certbot python3-certbot-nginx
```
2. 为域名申请证书
```bash
certbot --nginx -d couchdb.yoursite.com
```

#### 自动续订证书

1. 运行以下命令测试 Certbot 是否能够成功续订证书：
```bash
certbot renew --dry-run
```
2.  创建自动续期的服务文件
```bash
vi /etc/systemd/system/certbot.service
```
- 文件内容如下：
```erlang
[Unit]
Description=Certbot
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --post-hook "systemctl reload nginx"

[Install]
WantedBy=multi-user.target
```
- 这将创建一个 Systemd 服务，用于在证书到期前自动续订证书，并在续订后重新加载 Nginx 配置。
3.  启用 Certbot 服务并启动自动续订：
```bash
systemctl enable certbot.service
systemctl start certbot.service
```

### Nginx 配置 SSL 和重定向

1. 配置 Nginx 的 nginx.conf 文件以代理 CouchDB SSL 连接
```bash
vi /etc/nginx/nginx.conf
```
- 将 server {} 块放入 http {} 块中
```nginx
server {
    listen 80;
    server_name couchdb.yoursite.com;
    return 301 https://couchdb.yoursite.com$request_uri;
}

server {
    listen 443 ssl;
    server_name couchdb.yoursite.com;

    ssl_certificate /etc/letsencrypt/live/couchdb.yoursite.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/couchdb.yoursite.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5984;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_redirect off;
        proxy_buffering off;
    }
}
```
- 这将配置 Nginx 监听 HTTP 和 HTTPS 请求，并将所有 HTTP 请求重定向到 HTTPS。
- 只代理特定域名，80转443，443加密5984。
2. 重新启动 Nginx 和 CouchDB：
```bash
service nginx restart
service couchdb restart
```
- 现在，仅当您在浏览器中输入 couchdb.yoursite.com，将自动代理到 couchdb.yoursite.com:5984，并使用您的官方证书对连接进行加密和验证。而不用专门将CouchDB绑定到特定子域名。

## 配置 LiveSync

### 启用 CORS

在网页 http(s)://yoursite.com/\_utils 登录，依次点击左侧齿轮图标 `Config` 选项 - `CORS` 标签，启用 CORS 并选择下方 Origin Domains 为 All domains。

### 配置插件

#### 远程数据库

- URI 包括协议头，不包括文件路径 \_utils
- 输入用户名、密码、仓库名
- 底部 test 操作判断是否连接正常
- 点击 Check database configuration，fix 所有警告

#### 同步设置

- 启用实时同步
- 下方文件删除标题下，打开删除文件到回收站选项
- 再往下可以选择启用隐藏文件同步，有三种状态
	- Merge - 同步不冲突的修改
	- Fetch - 远程同步到本地
	- overwrite - 本地同步到远程

#### 杂项设置

- 打开在编辑器显示同步状态，状态有：
	-  ⏹️ 准备就绪
	- 💤 LiveSync 已启用，正在等待更改
	- ⚡️ 同步中
	- ⚠️ 出现错误
- 描述信息：
	-   ↑ 上传的 chunk 和元数据数量
	-   ↓ 下载的 chunk 和元数据数量
	-   ⏳ 等待的过程的数量
	-   🧩 正在等待 chunk 的文件数量。如果你删除或修改了文件名称，请等待 ⏳ 图标消失。

#### 安装于其他设备

- 在设置向导底部，点击复制设置链接，输入加密密码 A
	- 注意：这个链接中包含了重要的敏感数据
- 在要同步的设备中，点击打开设置链接，输入密码 A
- 在弹出的选项中，推荐选择第一个 - 设为辅助设备
- 弹出选项，是否将远程隐藏文件同步到本地。

## 其他

### 配置防火墙（可选）

1. 安装并启用 UFW
```bash
apt install ufw
ufw enable
```
2. 添加已启用的端口：
```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 5984/tcp
ufw allow 6984/tcp
```
3. 检查状态
```bash
ufw status
```

### 参考网站

- [官网](https://docs.couchdb.org/en/stable/)：
	- [Enabling the Apache CouchDB package repository](https://docs.couchdb.org/en/latest/install/unix.html#enabling-the-apache-couchdb-package-repository)
	- [HTTPS (SSL/TLS) Options](https://docs.couchdb.org/en/latest/config/http.html#https-ssl-tls-options)
- 配置 LiveSync：
	- [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync/blob/main/README_cn.md#self-hosted-livesync) - Github 
	- [LiveSync - 山茶花舍](https://irithys.com/p/obsidian-livesync/#%E5%88%9B%E5%BB%BA%E6%95%B0%E6%8D%AE%E5%BA%93)

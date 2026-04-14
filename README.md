# push-npm-tar

通过命令行将通过 `fetch-npm-tar `下载的tgz文件上传到私有npm仓库中

## 使用

可以全局安装 `npm i push-npm-tar -g`, 然后使用 `push-npm-tar`

也可以临时使用 `npx push-npm-tar`

上传时npm会要求添加用户，可在命令行目录下添加 .npmrc 文件

```ini
# 要上传的目标仓库地址
registry=http://127.0.0.1:4873/

# 针对目标仓库设置对应的token，如果时免登录的，token可以随便填一个字符串
//127.0.0.1:4873/:_authToken=xxxx-xxxx-xxxx-xxxx
```

```sh


# 上传当前路径下的 storage 目录
push-npm-tar
# 指定目录
push-npm-tar --dir="path_to_store_tgz"
```

# 参数说明

| 参数                       | 说明                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| --version<br />-v          | 查看当前版本号                                                                      |
| --help<br />-h             | 查看帮助信息                                                                        |
| --registry<br />-r         | 指定要上传的目标仓库地址，默认会是当前上下文路径获取的 npm registry                 |
| --dir<br />-d              | tgz 文件存放路径，默认为当前路径下的 `storage` 文件夹                               |
| --limit<br />-l            | 指定并发下载数，默认为 cpu 核数的两倍                                               |
| --skipVersionCheck<br />-s | 跳过版本检查，默认会自动检查 `push-npm-tar`包的版本更新<br />并要求最新版才可以推送 |

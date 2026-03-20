# push-npm-tar

通过命令行将通过 `fetch-npm-tar `下载的tgz文件上传到私有npm仓库中

## 使用

可以全局安装 `npm i push-npm-tar -g`, 然后使用 push `-npm-tar`

也可以临时使用 `npx push-npm-tar`

```sh


# 上传当前路径下的 storage 目录
push-npm-tar
# 指定目录
push-npm-tar --dir="path_to_store_tgz"
```

# 参数说明

| 参数               | 说明                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| --version<br />-v  | 查看当前版本号                                                                                                                                  |
| --help<br />-h     | 查看帮助信息                                                                                                                                    |
| --registry<br />-r | 指定lockfile文件路径<br /> `--lockfile="path_to_yaml"` <br /> `--lockfile "path_to_yaml"` <br /> `-f "path_to_yaml"` <br /> `-f="path_to_yaml"` |
| --dir<br />-d      | tgz 文件存放路径，默认为当前路径下的 `storage` 文件夹                                                                                           |
| --limit<br />-l    | 指定并发下载数，默认为 cpu 核数的两倍                                                                                                           |

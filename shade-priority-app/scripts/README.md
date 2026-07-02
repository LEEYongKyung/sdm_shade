# Server Scripts

## deploy.sh

NHN Cloud Ubuntu 서버에서 앱을 갱신하는 배포 스크립트입니다.

기본값:

- Repository: `/home/ubuntu/Workspace/sdm_shade`
- App: `/home/ubuntu/Workspace/sdm_shade/shade-priority-app`
- Branch: `main`
- Web root: `/var/www/sdm-shade`
- PM2 process: `sdm-shade-api`
- API health check: `http://127.0.0.1:5174/api/health`

서버에서 실행:

```bash
cd /home/ubuntu/Workspace/sdm_shade/shade-priority-app
bash scripts/deploy.sh
```

경로를 바꿔 실행해야 할 때:

```bash
APP_DIR=/home/ubuntu/Workspace/sdm_shade/shade-priority-app \
WEB_ROOT=/var/www/sdm-shade \
PM2_NAME=sdm-shade-api \
bash scripts/deploy.sh
```

로컬 변경분으로만 빌드하고 `git pull`을 건너뛰려면:

```bash
SKIP_PULL=1 bash scripts/deploy.sh
```

# SalesGrid Android shell

Capacitor 8 wrapper that loads the deployed SalesGrid server (`SALESGRID_SERVER_URL`).
Full guide — setup, signing, CI, what needs a new APK, device test checklist: [`docs/MOBILE_ANDROID.md`](../../docs/MOBILE_ANDROID.md).

```bash
npm ci
SALESGRID_SERVER_URL=https://salesgrid.yourcompany.com npm run build:debug
```

# 📦 Favicon RevalidaOSCE — instruções

## 1. Upload dos arquivos

Faça upload **TODOS** os arquivos abaixo para a **raiz** do seu site (mesmo nível do `index.html`):

```
favicon.ico
favicon.svg
favicon-16x16.png
favicon-32x32.png
favicon-48x48.png
favicon-96x96.png
favicon-192x192.png
apple-touch-icon.png
android-chrome-192x192.png
android-chrome-512x512.png
mstile-150x150.png
site.webmanifest
browserconfig.xml
```

**Importante**: faça upload em ambos:
- `revalidaosce.com.br` (landing)
- `simulador.revalidaosce.com.br` (simulador)

## 2. Adicionar tags HTML

No `<head>` da landing E do simulador, adicione (ou substitua) estas tags:

```html
<!-- Favicon — RevalidaOSCE -->
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="msapplication-config" content="/browserconfig.xml">
<meta name="msapplication-TileColor" content="#0a1a2e">
<meta name="theme-color" content="#00c9ff">
```

## 3. Cache busting (importante!)

Browsers cacheiam favicon agressivamente. Após o upload:

**Opção A — query string** (mais simples):
```html
<link rel="icon" type="image/x-icon" href="/favicon.ico?v=2">
```

**Opção B — hard refresh**: Ctrl+Shift+R em todos os dispositivos de teste.

Pode demorar até 24h para todos os usuários verem o novo favicon.

## 4. Testar

- Desktop: aba do navegador
- iOS: salvar na tela inicial → vê o ícone
- Android: salvar na tela inicial → vê o ícone
- Windows 10/11: pinned site na taskbar

## 5. Verificar SEO

Use https://realfavicongenerator.net/favicon_checker para testar se está tudo certo.

# Instalação do Favicon — RevalidaOSCE

## Como instalar

### 1. Suba TODOS os arquivos na RAIZ do site
Os 14 arquivos deste pacote devem ficar em:
- `revalidaosce.com.br/favicon.ico`
- `revalidaosce.com.br/favicon.svg`
- (e todos os demais)

### 2. Adicione no `<head>` de cada HTML:

```html
<!-- Favicon — RevalidaOSCE -->
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#00c9ff">
```

### 3. Faça hard refresh
Browsers cacheiam favicon agressivamente. Pode demorar até 24h pra todos verem.
Pra forçar atualização: Ctrl+Shift+R (Windows) ou Cmd+Shift+R (Mac).

## Design

- **Símbolo**: cruz médica + 2 pontinhos laterais (opacidade 65%)
- **Cores**: cyan `#00c9ff` sobre azul-marinho gradiente (`#0d2138` → `#050d1a`)
- **Cantos**: arredondados (radius 18% do tamanho)

## Adaptação por tamanho

- **16x16**: cruz sólida SEM pontinhos (legibilidade priorizada)
- **32px+**: cruz + 2 pontinhos laterais (design completo)

## Lista de arquivos

| Arquivo | Pra que serve |
|---------|---------------|
| `favicon.svg` | Vetorial moderno (browsers atuais) |
| `favicon.ico` | Compatibilidade (browsers antigos, contém 16+32+48) |
| `favicon-16x16.png` | Tab pequena |
| `favicon-32x32.png` | Tab padrão |
| `favicon-48x48.png` | Atalho desktop |
| `favicon-96x96.png` | Android legado |
| `favicon-192x192.png` | PWA medium |
| `apple-touch-icon.png` | iOS tela inicial (180x180) |
| `android-chrome-192x192.png` | Android Chrome moderno |
| `android-chrome-512x512.png` | Android HD / splash |
| `mstile-150x150.png` | Windows 10/11 tile |
| `browserconfig.xml` | Config Windows |
| `site.webmanifest` | Web app manifest |
| `INSTALAR.md` | Este arquivo |

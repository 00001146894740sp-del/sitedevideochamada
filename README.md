# VideoCall WebRTC

Aplicação simples de videochamadas em tempo real construída com **Node.js**, **Express**, **Socket.IO** e **WebRTC**.

## Funcionalidades
- Criação de salas com código aleatório
- Entrada em salas existentes por código
- Bloqueio/desbloqueio de microfone em tempo real
- Bloqueio/desbloqueio de câmera em tempo real

## Como rodar localmente

1. Clone o repositório:
   ```bash
   git clone https://github.com
   cd videochamada-webrtc
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Inicie o servidor:
   ```bash
   npm start
   ```

4. Acesse `http://localhost:3000` em duas abas ou dispositivos na mesma rede.

> **Nota sobre HTTPS:** Navegadores exigem conexão segura (`HTTPS`) para liberar câmera e microfone fora de `localhost`. Para publicar online, utilize serviços que fornecem SSL automático (como Render, Railway ou Fly.io).

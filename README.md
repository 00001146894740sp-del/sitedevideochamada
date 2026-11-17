# Site de Videochamada (GitHub + Render)

Aplicação completa de videochamada em tempo real usando **Node.js**, **Express**, **Socket.io** e **WebRTC**.

## Estrutura de Pastas no GitHub

Organize os arquivos exatamente assim no seu repositório:

```text
seu-repositorio/
├── package.json
├── server.js
├── README.md
└── public/
    └── index.html
```

> **Atenção:** O arquivo `index.html` deve ficar dentro de uma pasta chamada `public`.

## Como subir no Render

1. Crie um repositório no **GitHub** e envie esses arquivos mantendo a estrutura acima.
2. Acesse o painel do **Render** e clique em **New +** > **Web Service**.
3. Conecte seu repositório do GitHub.
4. Preencha as configurações:
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Escolha o plano **Free** e clique em **Create Web Service**.
6. Assim que o deploy terminar, abra o link HTTPS gerado pelo Render (o WebRTC exige HTTPS para liberar câmera e microfone).

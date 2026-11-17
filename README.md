# Termo de Entrega · Farmasi Arena

Termo de entrega e responsabilidade dos camarins e salas de produção, assinado pelo cliente na tela. Substitui o Word "TERMO DE RESPONSABILIDADE CAMARIM E SALAS DE PRODUÇÃO 2026.doc" (mesmo texto, mesmas 3 cláusulas, mesma relação de mobiliário).

## Como funciona
1. **Evento**: a equipe preenche o evento e quem recebe (nome e documento são obrigatórios).
2. **Salas**: escolhe as salas entregues. A relação vem do `padrao.json`; dá para ajustar a quantidade e pôr item a mais (sai marcado no PDF).
3. **Fotos**: uma ou mais fotos de cada sala (reduzidas no aparelho para 1600 px).
4. **Assinar**: quem entrega assina (opcional) e escolhe:
   - **Assinar neste aparelho**: entrega o celular ou tablet ao cliente;
   - **Mandar por WhatsApp** ou **Copiar link**: o cliente assina no celular dele.

O link `/assinar/<chave>` não pede senha e mostra **só aquele termo** (ler, ver fotos, assinar e baixar a cópia). A chave é aleatória e não dá acesso a mais nada.

Depois de assinado, o termo **fica trancado**: o servidor grava data e hora, IP e aparelho, e calcula um **código de conferência** (SHA-256 dos dados, das salas, das fotos e das assinaturas). A tela da equipe mostra se o termo ainda confere com o código. O PDF sai com a marca, as assinaturas e o código.

## Arquivos
- `server.js`: servidor sem dependências (Node 20). Guarda tudo em `DADOS_DIR`:
  - `termos.json` (todos os termos), `fotos/<termo>/` (fotos da entrega) e `copias/` (uma cópia por dia, últimas 60).
- `public/pagina.html`: a página inteira (equipe e cliente). Ícones de traço em SVG, sem emoji.
- `padrao.json`: a relação de mobiliário das 13 salas (137 peças) e o valor da taxa. Mudar aqui vale para os termos **novos**; os já criados guardam a própria cópia.

## Senhas (variáveis no Coolify)
| Variável | Quem usa | O que pode |
|---|---|---|
| `SENHA_ADMIN` | Administrador | Tudo, inclusive apagar termo |
| `SENHA` | Equipe de operações | Criar, preencher, tirar fotos, mandar o link e gerar o PDF |

O cliente não usa senha. Nunca escreva as senhas neste repositório.

## Coolify
- Build pack: Dockerfile. Porta: 3000.
- Volume persistente em `/app/dados` (sem ele, termos e fotos somem a cada deploy).
- Variáveis `SENHA_ADMIN` e `SENHA`.
- Domínio com `https://` (o link do cliente usa o endereço do site).

## Rodar no computador
`SENHA=equipe SENHA_ADMIN=admin node server.js` e abrir http://localhost:3000. Sem nenhuma senha, entra direto como administrador.

## Testes
`npm test` (sobe o servidor numa pasta temporária e confere o fluxo inteiro da API).

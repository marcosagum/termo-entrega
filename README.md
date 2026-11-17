# Termo de Entrega · Farmasi Arena

Termo de entrega e responsabilidade dos camarins, salas de produção, chaves e controles, assinado pelo cliente na tela. Junta os dois Words da pasta TERMOS num só:
- "TERMO DE RESPONSABILIDADE CAMARIM E SALAS DE PRODUÇÃO 2026.doc": mesmo texto (cláusulas 1 a 3) e mesma relação de mobiliário;
- "Termo de entrega de chaves e controles.doc": vira a cláusula 4 e a lista de chaves e controles, com a devolução no fim da desmontagem.

## Como funciona
1. **Evento**: a equipe preenche o evento e quem recebe (nome e documento são obrigatórios).
2. **Salas**: escolhe as salas entregues. A relação vem do `padrao.json`; dá para ajustar a quantidade e pôr item a mais (sai marcado no PDF). Embaixo ficam as **chaves e controles**: a chave de cada sala escolhida já vem marcada; a Sala 112/113 e os controles do ar são marcados à mão.
3. **Fotos**: uma ou mais fotos de cada sala (reduzidas no aparelho para 1600 px).
4. **Assinar**: quem entrega assina (opcional) e escolhe:
   - **Assinar neste aparelho**: entrega o celular ou tablet ao cliente;
   - **Mandar por WhatsApp** ou **Copiar link**: o cliente assina no celular dele.

O link `/assinar/<chave>` não pede senha e mostra **só aquele termo** (ler, ver fotos, assinar e baixar a cópia). A chave é aleatória e não dá acesso a mais nada.

Depois de assinado, o termo **fica trancado**: o servidor grava data e hora, IP e aparelho, e calcula um **código de conferência** (SHA-256 dos dados, das salas, das fotos e das assinaturas). A tela da equipe mostra se o termo ainda confere com o código. O PDF sai com a marca, as assinaturas e o código.

**Devolução das chaves e controles:** depois do show, na etapa Assinar, a equipe conta o que voltou ("Voltou tudo" ou item por item), quem devolve assina na tela da equipe e a devolução fica registrada com o seu próprio código (ligado ao código da entrega). Se faltar item, o termo mostra o que não voltou (base para cobrar pela cláusula 4) e a lista marca "Faltou". A devolução sai numa página própria do PDF; sem devolução registrada, essa página sai com as linhas em branco para assinar no papel.

## Arquivos
- `server.js`: servidor sem dependências (Node 20). Guarda tudo em `DADOS_DIR`:
  - `termos.json` (todos os termos), `fotos/<termo>/` (fotos da entrega) e `copias/` (uma cópia por dia, últimas 60).
- `public/pagina.html`: a página inteira (equipe e cliente). Ícones de traço em SVG, sem emoji.
- `padrao.json`: a relação de mobiliário das 13 salas (137 peças), a lista de chaves e controles (14 chaves e 2 controles do ar) e o valor da taxa. Mudar aqui vale para os termos **novos**; os já criados guardam a própria cópia.

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

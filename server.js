// Servidor do Termo de Entrega (Farmasi Arena): termo de entrega e responsabilidade dos
// camarins, salas de produção, chaves e controles, assinado pelo cliente na tela.
// A devolução das chaves e controles é registrada depois, com a assinatura de quem devolve.
// Sem dependências: Node 20 puro. Os dados ficam em DADOS_DIR (no Coolify, um volume):
//   termos.json         todos os termos
//   fotos/<termo>/...   fotos da entrega
//   copias/             uma cópia do termos.json por dia (últimas 60)
//
// Duas senhas (variáveis de ambiente):
//   SENHA_ADMIN  administrador: tudo, inclusive apagar termo
//   SENHA        equipe: cria, preenche, tira fotos, manda o link e gera o PDF
// O cliente não tem senha: o link /assinar/<chave> abre só o termo dele, para ler e assinar.
// Depois de assinado, o termo não muda mais.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTA = Number(process.env.PORT || 3000);
const DADOS_DIR = process.env.DADOS_DIR || path.join(__dirname, 'dados');
const ARQ = path.join(DADOS_DIR, 'termos.json');
const FOTOS = path.join(DADOS_DIR, 'fotos');
const SENHA = process.env.SENHA || '';
const SENHA_ADMIN = process.env.SENHA_ADMIN || '';
const LIMITE = 256 * 1024;          // pedidos comuns
const LIMITE_FOTO = 4 * 1024 * 1024; // foto já reduzida no aparelho
const PADRAO = JSON.parse(fs.readFileSync(path.join(__dirname, 'padrao.json'), 'utf8'));

// ---------- dados ----------
fs.mkdirSync(FOTOS, { recursive: true });
let dados = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, 'utf8')) : { seq: {}, termos: {} };
dados.seq = dados.seq || {};
dados.termos = dados.termos || {};
// termos criados antes das chaves ganham a lista, toda desmarcada (não muda o que já foi assinado)
Object.values(dados.termos).forEach(t => { if (!t.chaves) t.chaves = chavesPadrao(); if (t.devolucao === undefined) t.devolucao = null; });
salvar();

function chavesPadrao() {
  const out = {};
  PADRAO.chaves.forEach(k => { out[k.id] = { nome: k.nome, tipo: k.tipo, q: k.q, on: false }; });
  return out;
}

function salvar() {
  const tmp = ARQ + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dados));
  fs.renameSync(tmp, ARQ);
  const dir = path.join(DADOS_DIR, 'copias');
  fs.mkdirSync(dir, { recursive: true });
  const nome = path.join(dir, `termos-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(nome)) {
    fs.copyFileSync(ARQ, nome);
    fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().slice(0, -60).forEach(f => fs.unlinkSync(path.join(dir, f)));
  }
}

// ---------- senhas ----------
const PAPEIS = [['admin', SENHA_ADMIN], ['equipe', SENHA]];
const fichaDe = (senha, papel) => crypto.createHmac('sha256', senha).update('termo-' + papel).digest('hex');
const fichas = PAPEIS.filter(([, s]) => s).map(([papel, s]) => [papel, fichaDe(s, papel)]);
const NIVEL = { equipe: 1, admin: 2 };
const tentativas = new Map();
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function igual(a, b) { return !!a && !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function papelDe(req) {
  if (!fichas.length) return 'admin'; // sem senha configurada (só no computador)
  const c = cookies(req).te_sessao || '';
  const f = fichas.find(([, ficha]) => igual(c, ficha));
  return f ? f[0] : null;
}
function ipDe(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''; }
function bloqueado(ip, limite = 10) {
  const agora = Date.now(), t = (tentativas.get(ip) || []).filter(x => agora - x < 10 * 60000);
  tentativas.set(ip, t);
  return t.length >= limite;
}

// ---------- termos ----------
const CAMPOS = ['evento', 'dataEvento', 'dataTermo', 'resp', 'doc', 'empresa', 'tel', 'email', 'arena'];
const texto = (v, max) => typeof v === 'string' && v.length <= max;
const cheio = v => typeof v === 'string' && v.trim().length > 0;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hoje = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // horário de Brasília

function novoTermo() {
  const ano = hoje().slice(0, 4);
  dados.seq[ano] = (dados.seq[ano] || 0) + 1;
  const id = 't' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const salas = {};
  PADRAO.salas.forEach(s => { salas[s.id] = { nome: s.nome, g: s.g, on: false, it: s.itens.map(x => ({ n: x.n, q: x.q, p: x.q })) }; });
  return {
    id,
    numero: `TE-${ano}-${String(dados.seq[ano]).padStart(4, '0')}`,
    chave: crypto.randomBytes(18).toString('base64url'),
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    taxa: PADRAO.taxa,
    campos: { dataTermo: hoje() },
    salas,
    chaves: chavesPadrao(),
    fotos: {},
    assArena: null,
    linkEm: null,
    assinatura: null,
    devolucao: null,
  };
}

function validarCampos(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'Dados inválidos';
  for (const [k, v] of Object.entries(c)) {
    if (!CAMPOS.includes(k)) return 'Campo não aceito: ' + k;
    if (!texto(v, 200)) return 'Campo longo demais: ' + k;
    if ((k === 'dataEvento' || k === 'dataTermo') && v && !DATA.test(v)) return 'Data inválida';
  }
  return null;
}
function validarSalas(salas, atual) {
  if (!salas || typeof salas !== 'object' || Array.isArray(salas)) return 'Salas inválidas';
  const ids = Object.keys(salas);
  if (ids.length !== Object.keys(atual).length || ids.some(id => !atual[id])) return 'Salas inválidas';
  for (const id of ids) {
    const s = salas[id];
    if (!s || typeof s.on !== 'boolean' || !Array.isArray(s.it) || s.it.length > 60) return 'Sala inválida: ' + id;
    for (const x of s.it) {
      if (!x || !cheio(x.n) || !texto(x.n, 80) || !Number.isInteger(x.q) || x.q < 0 || x.q > 999) return 'Item inválido em ' + atual[id].nome;
      if (x.p !== null && (!Number.isInteger(x.p) || x.p < 0 || x.p > 999)) return 'Item inválido em ' + atual[id].nome;
    }
  }
  return null;
}
function validarChaves(chaves, atual) {
  if (!chaves || typeof chaves !== 'object' || Array.isArray(chaves)) return 'Chaves inválidas';
  const ids = Object.keys(chaves);
  if (ids.length !== Object.keys(atual).length || ids.some(id => !atual[id])) return 'Chaves inválidas';
  for (const id of ids) {
    const k = chaves[id];
    if (!k || typeof k.on !== 'boolean' || !Number.isInteger(k.q) || k.q < 1 || k.q > 20) return 'Quantidade inválida: ' + atual[id].nome;
  }
  return null;
}
const chavesOn = t => Object.entries(t.chaves || {}).filter(([, k]) => k.on).map(([id, k]) => ({ id, ...k }));
function validarAssinatura(img) {
  return typeof img === 'string' && img.startsWith('data:image/png;base64,') && img.length < 600 * 1024;
}
function faltando(t) {
  const c = t.campos, m = [];
  if (!cheio(c.evento)) m.push('Nome do evento');
  if (!cheio(c.dataTermo)) m.push('Data do termo');
  if (!cheio(c.resp)) m.push('Nome do responsável');
  if (!cheio(c.doc)) m.push('Documento do responsável');
  if (!Object.values(t.salas).some(s => s.on)) m.push('Pelo menos uma sala');
  return m;
}

// O que o cliente assina: dados, salas entregues, fotos (pelo conteúdo), assinaturas e hora.
// O código de conferência é o SHA-256 disso: se algo mudar, o código não bate mais.
function conteudo(t) {
  const salas = Object.entries(t.salas).filter(([, s]) => s.on).map(([id, s]) => ({ id, nome: s.nome, it: s.it.map(x => [x.n, x.q]) }));
  const fotos = Object.entries(t.fotos).flatMap(([sala, lista]) => lista.map(f => ({ sala, hash: f.hash })));
  const out = { numero: t.numero, taxa: t.taxa, campos: t.campos, salas, fotos };
  const ch = chavesOn(t);
  if (ch.length) out.chaves = ch.map(k => [k.id, k.nome, k.q]); // só entra quando há chaves (termos antigos não mudam)
  return out;
}
// A devolução tem o seu próprio código, ligado ao código da assinatura da entrega.
function codigoDev(t, d) {
  return crypto.createHash('sha256').update(JSON.stringify({
    numero: t.numero, entrega: t.assinatura.codigo, itens: d.itens, nome: d.nome, doc: d.doc, recebeu: d.recebeu,
    img: crypto.createHash('sha256').update(d.img).digest('hex'), em: d.em,
  })).digest('hex');
}
const faltouDev = d => d ? d.itens.filter(x => x.dev < x.q).length : 0;
function codigoDe(t, assinatura) {
  return crypto.createHash('sha256').update(JSON.stringify({
    ...conteudo(t),
    arena: t.assArena ? crypto.createHash('sha256').update(t.assArena).digest('hex') : null,
    cliente: crypto.createHash('sha256').update(assinatura.img).digest('hex'),
    em: assinatura.em,
  })).digest('hex');
}

function resumo(t) {
  const on = Object.values(t.salas).filter(s => s.on);
  return {
    id: t.id, numero: t.numero, evento: t.campos.evento || '', resp: t.campos.resp || '',
    dataEvento: t.campos.dataEvento || '', criadoEm: t.criadoEm, linkEm: t.linkEm,
    assinadoEm: t.assinatura ? t.assinatura.em : null,
    salas: on.length, pecas: on.reduce((a, s) => a + s.it.reduce((b, x) => b + x.q, 0), 0),
    fotos: Object.values(t.fotos).reduce((a, l) => a + l.length, 0),
    chaves: chavesOn(t).length,
    devolvidoEm: t.devolucao ? t.devolucao.em : null,
    faltou: faltouDev(t.devolucao),
  };
}
// O que o cliente vê: só o termo dele, sem a chave, sem dados internos.
function publico(t) {
  const salas = {};
  Object.entries(t.salas).forEach(([id, s]) => { if (s.on) salas[id] = s; });
  const fotos = {};
  Object.entries(t.fotos).forEach(([id, l]) => { if (salas[id] && l.length) fotos[id] = l.map(f => f.nome); });
  const chaves = {};
  chavesOn(t).forEach(k => { chaves[k.id] = { nome: k.nome, tipo: k.tipo, q: k.q, on: true }; });
  const d = t.devolucao;
  return {
    numero: t.numero, versao: t.atualizadoEm, taxa: t.taxa, campos: t.campos, salas, chaves, fotos, assArena: t.assArena,
    faltando: faltando(t),
    assinatura: t.assinatura ? { img: t.assinatura.img, em: t.assinatura.em, codigo: t.assinatura.codigo } : null,
    devolucao: d ? { itens: d.itens, nome: d.nome, doc: d.doc, recebeu: d.recebeu, img: d.img, em: d.em, codigo: d.codigo } : null,
  };
}
function completo(t) {
  const out = JSON.parse(JSON.stringify(t));
  Object.keys(out.fotos).forEach(id => { out.fotos[id] = out.fotos[id].map(f => f.nome); });
  if (out.assinatura) out.assinatura.confere = codigoDe(t, t.assinatura) === t.assinatura.codigo;
  if (out.devolucao) out.devolucao.confere = codigoDev(t, t.devolucao) === t.devolucao.codigo;
  return out;
}
function apagarFotos(id) {
  fs.rmSync(path.join(FOTOS, id), { recursive: true, force: true });
}

// ---------- http ----------
function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(corpo === undefined ? '' : JSON.stringify(corpo));
}
function lerCorpo(req, limite = LIMITE) {
  return new Promise((ok, falha) => {
    let tam = 0; const partes = [];
    req.on('data', p => { tam += p.length; if (tam > limite) { falha({ status: 413 }); req.destroy(); } else partes.push(p); });
    req.on('end', () => { try { ok(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : null); } catch { falha({ status: 400 }); } });
    req.on('error', () => falha({ status: 400 }));
  });
}
const SEGURANCA = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};
const PAGINA = path.join(__dirname, 'public', 'pagina.html');
function servirPagina(res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...SEGURANCA });
  fs.createReadStream(PAGINA).pipe(res);
}
function servirFoto(res, id, nome) {
  if (!/^[a-z0-9]+\.jpg$/.test(nome)) return json(res, 404, { erro: 'Foto não encontrada' });
  const arq = path.join(FOTOS, id, nome);
  if (!fs.existsSync(arq)) return json(res, 404, { erro: 'Foto não encontrada' });
  res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable', ...SEGURANCA });
  fs.createReadStream(arq).pipe(res);
}
const porChave = chave => Object.values(dados.termos).find(t => igual(t.chave, chave));

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html' || /^\/assinar\/[A-Za-z0-9_-]{10,60}$/.test(p)) return servirPagina(res);
    if (p === '/logo_gl.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      return fs.createReadStream(path.join(__dirname, 'public', 'logo_gl.png')).pipe(res);
    }
    if (p === '/api/health') return json(res, 200, { ok: true, termos: Object.keys(dados.termos).length });

    // ----- cliente (sem senha, só com a chave do termo) -----
    const mp = p.match(/^\/api\/publico\/([A-Za-z0-9_-]{10,60})(\/assinar|\/fotos\/([a-z0-9]+\.jpg))?$/);
    if (mp) {
      const ip = ipDe(req);
      if (bloqueado(ip, 60)) return json(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' });
      const t = porChave(mp[1]);
      if (!t) { tentativas.get(ip).push(Date.now()); return json(res, 404, { erro: 'Termo não encontrado. Confira o link com a equipe da arena.' }); }
      if (mp[3]) return servirFoto(res, t.id, mp[3]);
      if (!mp[2] && req.method === 'GET') return json(res, 200, publico(t));
      if (mp[2] && req.method === 'POST') {
        if (t.assinatura) return json(res, 409, { erro: 'Este termo já foi assinado.' });
        const corpo = await lerCorpo(req, 700 * 1024);
        if (!corpo || corpo.aceite !== true) return json(res, 400, { erro: 'Marque "Li e concordo" para assinar.' });
        if (!validarAssinatura(corpo.img)) return json(res, 400, { erro: 'Faça a assinatura no quadro.' });
        if (corpo.numero !== t.numero || corpo.versao !== t.atualizadoEm) return json(res, 409, { erro: 'O termo foi alterado pela equipe enquanto você lia. A página vai recarregar para você ver a versão atual.' });
        const m = faltando(t);
        if (m.length) return json(res, 400, { erro: 'O termo ainda não está pronto. Falta: ' + m.join(', ') });
        const assinatura = { img: corpo.img, em: new Date().toISOString(), ip, aparelho: String(req.headers['user-agent'] || '').slice(0, 300), aceite: true };
        assinatura.codigo = codigoDe(t, assinatura);
        t.assinatura = assinatura;
        salvar();
        return json(res, 200, publico(t));
      }
      return json(res, 405, { erro: 'Método não aceito' });
    }

    // ----- equipe -----
    if (p === '/api/entrar' && req.method === 'POST') {
      const ip = ipDe(req);
      if (bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Espere 10 minutos.' });
      const corpo = await lerCorpo(req);
      const senha = corpo && typeof corpo.senha === 'string' ? corpo.senha : '';
      const achou = PAPEIS.find(([, s]) => s && senha === s);
      if (achou) {
        const ficha = fichas.find(([papel]) => papel === achou[0])[1];
        const seguro = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
        res.setHeader('set-cookie', `te_sessao=${ficha}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${seguro}`);
        return json(res, 200, { ok: true, papel: achou[0] });
      }
      tentativas.get(ip).push(Date.now());
      return json(res, 401, { erro: 'Senha errada' });
    }
    if (p === '/api/sair' && req.method === 'POST') {
      res.setHeader('set-cookie', 'te_sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    const papel = papelDe(req);
    if (p.startsWith('/api/') && !papel) return json(res, 401, { erro: 'Entre com a senha' });

    if (p === '/api/eu') return json(res, 200, { papel });

    if (p === '/api/termos' && req.method === 'GET') {
      return json(res, 200, Object.values(dados.termos).map(resumo).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)));
    }
    if (p === '/api/termos' && req.method === 'POST') {
      const t = novoTermo();
      dados.termos[t.id] = t;
      salvar();
      return json(res, 200, completo(t));
    }

    const mt = p.match(/^\/api\/termos\/(t[a-z0-9]{1,40})(?:\/(fotos|link|devolucao)(?:\/([A-Za-z0-9]{1,6})(?:\/([a-z0-9]+\.jpg))?)?)?$/);
    if (mt) {
      const t = dados.termos[mt[1]];
      if (!t) return json(res, 404, { erro: 'Termo não encontrado' });
      const [, id, sub, sala, nome] = mt;

      if (!sub) {
        if (req.method === 'GET') return json(res, 200, completo(t));
        if (req.method === 'DELETE') {
          if (NIVEL[papel] < NIVEL.admin) return json(res, 403, { erro: 'Só o administrador pode apagar um termo' });
          delete dados.termos[id];
          apagarFotos(id);
          salvar();
          return json(res, 204);
        }
        if (req.method === 'PUT') {
          if (t.assinatura) return json(res, 409, { erro: 'Termo já assinado: não pode mais mudar' });
          const corpo = await lerCorpo(req, 900 * 1024);
          if (!corpo || typeof corpo !== 'object') return json(res, 400, { erro: 'Pedido inválido' });
          if (corpo.campos !== undefined) { const e = validarCampos(corpo.campos); if (e) return json(res, 400, { erro: e }); }
          if (corpo.salas !== undefined) { const e = validarSalas(corpo.salas, t.salas); if (e) return json(res, 400, { erro: e }); }
          if (corpo.chaves !== undefined) { const e = validarChaves(corpo.chaves, t.chaves); if (e) return json(res, 400, { erro: e }); }
          if (corpo.assArena !== undefined && corpo.assArena !== null && !validarAssinatura(corpo.assArena)) return json(res, 400, { erro: 'Assinatura inválida' });
          if (corpo.campos !== undefined) t.campos = corpo.campos;
          if (corpo.salas !== undefined) Object.entries(corpo.salas).forEach(([sid, s]) => { t.salas[sid].on = s.on; t.salas[sid].it = s.it.map(x => ({ n: x.n.trim(), q: x.q, p: x.p })); });
          if (corpo.chaves !== undefined) Object.entries(corpo.chaves).forEach(([kid, k]) => { t.chaves[kid].on = k.on; t.chaves[kid].q = k.q; });
          if (corpo.assArena !== undefined) t.assArena = corpo.assArena;
          t.atualizadoEm = new Date().toISOString();
          salvar();
          return json(res, 200, { atualizadoEm: t.atualizadoEm });
        }
        return json(res, 405, { erro: 'Método não aceito' });
      }

      // Devolução das chaves e controles: no fim da desmontagem, quem devolve assina na tela da equipe.
      if (sub === 'devolucao' && !sala && req.method === 'POST') {
        if (!t.assinatura) return json(res, 409, { erro: 'O termo ainda não foi assinado na entrega' });
        if (t.devolucao) return json(res, 409, { erro: 'A devolução já foi registrada' });
        const entregues = chavesOn(t);
        if (!entregues.length) return json(res, 400, { erro: 'Este termo não tem chaves nem controles' });
        const corpo = await lerCorpo(req, 700 * 1024);
        if (!corpo || typeof corpo.itens !== 'object' || !corpo.itens) return json(res, 400, { erro: 'Pedido inválido' });
        for (const k of entregues) {
          const v = corpo.itens[k.id];
          if (!Number.isInteger(v) || v < 0 || v > k.q) return json(res, 400, { erro: 'Quantidade devolvida inválida: ' + k.nome });
        }
        if (Object.keys(corpo.itens).length !== entregues.length) return json(res, 400, { erro: 'Pedido inválido' });
        if (!cheio(corpo.nome) || !texto(corpo.nome, 120)) return json(res, 400, { erro: 'Preencha o nome de quem devolve' });
        if (!texto(corpo.doc || '', 60) || !texto(corpo.recebeu || '', 120)) return json(res, 400, { erro: 'Dados longos demais' });
        if (!validarAssinatura(corpo.img)) return json(res, 400, { erro: 'Falta a assinatura de quem devolve' });
        const d = {
          itens: entregues.map(k => ({ id: k.id, nome: k.nome, q: k.q, dev: corpo.itens[k.id] })),
          nome: corpo.nome.trim(), doc: (corpo.doc || '').trim(), recebeu: (corpo.recebeu || '').trim(),
          img: corpo.img, em: new Date().toISOString(), ip: ipDe(req), aparelho: String(req.headers['user-agent'] || '').slice(0, 300),
        };
        d.codigo = codigoDev(t, d);
        t.devolucao = d;
        salvar();
        return json(res, 200, completo(t));
      }

      if (sub === 'link' && req.method === 'POST') {
        if (!t.linkEm) { t.linkEm = new Date().toISOString(); salvar(); }
        return json(res, 200, { chave: t.chave, linkEm: t.linkEm });
      }

      if (sub === 'fotos') {
        if (sala && nome && req.method === 'GET') return servirFoto(res, id, nome);
        if (!sala || !t.salas[sala]) return json(res, 404, { erro: 'Sala não encontrada' });
        if (t.assinatura) return json(res, 409, { erro: 'Termo já assinado: não pode mais mudar' });
        if (!nome && req.method === 'POST') {
          const corpo = await lerCorpo(req, LIMITE_FOTO);
          const m = corpo && typeof corpo.img === 'string' && corpo.img.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
          if (!m) return json(res, 400, { erro: 'Foto inválida' });
          const buf = Buffer.from(m[1], 'base64');
          if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return json(res, 400, { erro: 'Foto inválida' });
          const lista = t.fotos[sala] = t.fotos[sala] || [];
          if (lista.length >= 30) return json(res, 400, { erro: 'Máximo de 30 fotos por sala' });
          const arq = Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + '.jpg';
          fs.mkdirSync(path.join(FOTOS, id), { recursive: true });
          fs.writeFileSync(path.join(FOTOS, id, arq), buf);
          lista.push({ nome: arq, hash: crypto.createHash('sha256').update(buf).digest('hex') });
          t.atualizadoEm = new Date().toISOString();
          salvar();
          return json(res, 200, { nome: arq, atualizadoEm: t.atualizadoEm });
        }
        if (nome && req.method === 'DELETE') {
          const lista = t.fotos[sala] || [];
          const i = lista.findIndex(f => f.nome === nome);
          if (i < 0) return json(res, 404, { erro: 'Foto não encontrada' });
          lista.splice(i, 1);
          if (!lista.length) delete t.fotos[sala];
          fs.rmSync(path.join(FOTOS, id, nome), { force: true });
          t.atualizadoEm = new Date().toISOString();
          salvar();
          return json(res, 200, { atualizadoEm: t.atualizadoEm });
        }
      }
      return json(res, 405, { erro: 'Método não aceito' });
    }

    json(res, 404, { erro: 'Não encontrado' });
  } catch (e) {
    if (e && e.status) return json(res, e.status, { erro: e.status === 413 ? 'Arquivo grande demais' : 'Pedido inválido' });
    console.error(e);
    json(res, 500, { erro: 'Erro interno' });
  }
});

servidor.listen(PORTA, () => console.log(`Termo de Entrega no ar na porta ${PORTA} · senhas: administrador ${SENHA_ADMIN ? 'sim' : 'NÃO'}, equipe ${SENHA ? 'sim' : 'NÃO'}`));

// Teste da API, sem dependências: sobe o servidor numa pasta temporária e confere o fluxo inteiro.
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'termo-'));
const PORTA = 3900 + Math.floor(Math.random() * 90);
const B = `http://127.0.0.1:${PORTA}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: PORTA, DADOS_DIR: DIR, SENHA: 'equipe', SENHA_ADMIN: 'admin' }, stdio: 'inherit' });
let cookie = '';
async function r(met, url, corpo, ck = cookie) {
  const res = await fetch(B + url, { method: met, headers: { 'content-type': 'application/json', cookie: ck }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  return { s: res.status, j };
}
const JPG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
(async () => {
  await new Promise(ok => setTimeout(ok, 600));
  try {
    assert.strictEqual((await r('GET', '/api/termos')).s, 401, 'sem senha não lista');
    assert.strictEqual((await r('POST', '/api/entrar', { senha: 'errada' })).s, 401);
    assert.strictEqual((await r('POST', '/api/entrar', { senha: 'equipe' })).s, 200);
    const equipe = cookie;
    let t = (await r('POST', '/api/termos')).j;
    assert.match(t.numero, /^TE-\d{4}-0001$/);
    assert.strictEqual(Object.keys(t.salas).length, 13);
    // cliente: termo ainda em preparo
    let pub = (await r('GET', '/api/publico/' + t.chave, null, '')).j;
    assert.ok(pub.faltando.length > 0);
    assert.strictEqual(pub.chave, undefined, 'cliente não vê a chave');
    assert.strictEqual((await r('POST', `/api/publico/${t.chave}/assinar`, { aceite: true, img: PNG, numero: t.numero, versao: pub.versao }, '')).s, 400, 'não assina termo incompleto');
    // equipe preenche
    t.campos = { ...t.campos, evento: 'Show Teste', resp: 'Fulana', doc: '123' };
    t.salas.C1.on = true; t.salas.C1.it[0].q = 2; t.salas.C1.it.push({ n: 'Frigobar', q: 1, p: null });
    assert.strictEqual(Object.keys(t.chaves).length, 15, 'lista de chaves do termo de chaves e controles');
    assert.strictEqual(t.chaves.AR.q, 2);
    t.chaves.C1.on = true; t.chaves.AR.on = true;
    assert.strictEqual((await r('PUT', '/api/termos/' + t.id, { chaves: { ...t.chaves, AR: { ...t.chaves.AR, q: 0 } } })).s, 400, 'quantidade zero');
    assert.strictEqual((await r('PUT', '/api/termos/' + t.id, { campos: t.campos, salas: t.salas, chaves: t.chaves })).s, 200);
    assert.strictEqual((await r('POST', `/api/termos/${t.id}/devolucao`, { itens: { C1: 1, AR: 2 }, nome: 'X', img: PNG })).s, 409, 'devolução antes da assinatura');
    assert.strictEqual((await r('PUT', '/api/termos/' + t.id, { campos: { hack: 1 } })).s, 400, 'campo estranho');
    const f = await r('POST', `/api/termos/${t.id}/fotos/C1`, { img: JPG });
    assert.strictEqual(f.s, 200);
    assert.strictEqual((await r('POST', `/api/termos/${t.id}/fotos/C1`, { img: 'data:image/jpeg;base64,AAAA' })).s, 400, 'foto falsa');
    assert.strictEqual((await r('GET', `/api/termos/${t.id}/fotos/C1/${f.j.nome}`)).s, 200);
    assert.strictEqual((await r('GET', `/api/termos/${t.id}/fotos/C1/${f.j.nome}`, null, '')).s, 401, 'foto da equipe pede senha');
    // cliente
    pub = (await r('GET', '/api/publico/' + t.chave, null, '')).j;
    assert.deepStrictEqual(pub.faltando, []);
    assert.deepStrictEqual(Object.keys(pub.salas), ['C1'], 'cliente só vê as salas entregues');
    assert.deepStrictEqual(Object.keys(pub.chaves), ['C1', 'AR'], 'cliente só vê as chaves entregues');
    assert.strictEqual((await r('GET', `/api/publico/${t.chave}/fotos/${f.j.nome}`, null, '')).s, 200);
    assert.strictEqual((await r('GET', '/api/publico/chaveerradaxxxxxxxx', null, '')).s, 404);
    assert.strictEqual((await r('POST', `/api/publico/${t.chave}/assinar`, { aceite: false, img: PNG, numero: t.numero, versao: pub.versao }, '')).s, 400, 'sem aceite');
    assert.strictEqual((await r('POST', `/api/publico/${t.chave}/assinar`, { aceite: true, img: PNG, numero: t.numero, versao: 'velha' }, '')).s, 409, 'versão velha');
    const as = await r('POST', `/api/publico/${t.chave}/assinar`, { aceite: true, img: PNG, numero: t.numero, versao: pub.versao }, '');
    assert.strictEqual(as.s, 200);
    assert.match(as.j.assinatura.codigo, /^[0-9a-f]{64}$/);
    assert.strictEqual((await r('POST', `/api/publico/${t.chave}/assinar`, { aceite: true, img: PNG, numero: t.numero, versao: pub.versao }, '')).s, 409, 'não assina duas vezes');
    // trancado
    assert.strictEqual((await r('PUT', '/api/termos/' + t.id, { campos: t.campos }, equipe)).s, 409);
    assert.strictEqual((await r('POST', `/api/termos/${t.id}/fotos/C1`, { img: JPG }, equipe)).s, 409);
    const full = (await r('GET', '/api/termos/' + t.id, null, equipe)).j;
    assert.strictEqual(full.assinatura.confere, true, 'código confere');
    assert.ok(full.assinatura.ip !== undefined);
    // devolução das chaves e controles
    const D = '/api/termos/' + t.id + '/devolucao';
    assert.strictEqual((await r('POST', D, { itens: { C1: 1, AR: 2 }, nome: 'Fulana', img: PNG }, '')).s, 401, 'devolução pede senha');
    assert.strictEqual((await r('POST', D, { itens: { C1: 1, AR: 3 }, nome: 'Fulana', img: PNG }, equipe)).s, 400, 'devolve mais do que recebeu');
    assert.strictEqual((await r('POST', D, { itens: { C1: 1 }, nome: 'Fulana', img: PNG }, equipe)).s, 400, 'falta item na contagem');
    assert.strictEqual((await r('POST', D, { itens: { C1: 1, AR: 1 }, nome: '', img: PNG }, equipe)).s, 400, 'sem nome');
    assert.strictEqual((await r('POST', D, { itens: { C1: 1, AR: 1 }, nome: 'Fulana' }, equipe)).s, 400, 'sem assinatura');
    const dv = await r('POST', D, { itens: { C1: 1, AR: 1 }, nome: 'Fulana', doc: '123', recebeu: 'Marcos', img: PNG }, equipe);
    assert.strictEqual(dv.s, 200);
    assert.strictEqual(dv.j.devolucao.confere, true, 'código da devolução confere');
    assert.strictEqual(dv.j.assinatura.confere, true, 'devolução não mexe na assinatura da entrega');
    assert.strictEqual((await r('POST', D, { itens: { C1: 1, AR: 2 }, nome: 'Fulana', img: PNG }, equipe)).s, 409, 'não devolve duas vezes');
    const lst = (await r('GET', '/api/termos', null, equipe)).j.find(x => x.id === t.id);
    assert.strictEqual(lst.faltou, 1, 'lista mostra a falta');
    pub = (await r('GET', '/api/publico/' + t.chave, null, '')).j;
    assert.strictEqual(pub.devolucao.itens.find(x => x.id === 'AR').dev, 1, 'cliente vê a devolução');
    assert.strictEqual(pub.devolucao.ip, undefined);
    // apagar: equipe não pode, admin pode
    assert.strictEqual((await r('DELETE', '/api/termos/' + t.id, null, equipe)).s, 403);
    await r('POST', '/api/entrar', { senha: 'admin' });
    assert.strictEqual((await r('DELETE', '/api/termos/' + t.id)).s, 204);
    assert.ok(!fs.existsSync(path.join(DIR, 'fotos', t.id)), 'fotos apagadas');
    // segundo termo do ano continua a numeração
    assert.match((await r('POST', '/api/termos')).j.numero, /-0002$/);
    console.log('API: tudo certo');
  } catch (e) { console.error('FALHOU:', e.message); process.exitCode = 1; }
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
})();

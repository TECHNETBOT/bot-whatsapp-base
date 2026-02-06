// src/sheets.js
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const C = require('./config');
const { normalizeText, normalizeSpaces, getField, safeReadJson, safeWriteJsonAtomic, extractPhones } = require('./utils');

let contratosCache = null;
let contratosCacheAtualizadoEm = 0;
let backlogCache = null;
let backlogCacheAtualizadoEm = 0;

// === BUSCA DE CONTRATOS (COM REGRA DE NÃO DUPLICAR) ===
const obterBaseContratos = async () => {
    const agora = Date.now();
    if (contratosCache && agora - contratosCacheAtualizadoEm < C.CONTRATOS_CACHE_TTL_MS) return contratosCache;

    try {
        const [resN, resF, resNova] = await Promise.all([
            axios.get(C.URL_NATAL, { timeout: 10000 }),
            axios.get(C.URL_FORTALEZA, { timeout: 10000 }),
            axios.get(C.URL_NOVA_TABELA, { timeout: 10000 })
        ]);

        // 1. Processar dados brutos
        const dadosNatal = parse(resN.data, { columns: true, skip_empty_lines: true, trim: true });
        const dadosFortaleza = parse(resF.data, { columns: true, trim: true });
        
        // Normalização da NOVA TABELA
        const dadosNova = parse(resNova.data, { columns: true, trim: true }).map(row => ({
            'Contrato': row['CONTRATO'],
            'Telefone 1': row['TEL1'],
            'Telefone 2': row['TEL2'],
            'Telefone 3': row['TEL3'],
            'Nome': row['NOME DO CLIENTE'],
            'Endereco': row['ENDEREÇO']
        }));

        // 2. Unificar e REMOVER DUPLICATAS
        const todosDados = [...dadosNatal, ...dadosFortaleza, ...dadosNova];
        const mapaSemDuplicatas = new Map();

        todosDados.forEach(item => {
            const numContrato = item['Contrato'];
            // Se tem contrato e ainda NÃO está no mapa, adiciona.
            // Se já estiver, ignora (mantendo o primeiro que encontrou).
            if (numContrato && !mapaSemDuplicatas.has(numContrato)) {
                mapaSemDuplicatas.set(numContrato, item);
            }
        });

        // Converte de volta para array
        contratosCache = Array.from(mapaSemDuplicatas.values());
        contratosCacheAtualizadoEm = agora;
        
        return contratosCache;

    } catch (err) {
        console.error("Erro ao baixar planilhas:", err.message);
        throw err;
    }
};

// === BACKLOG / FORA ROTA ===
const obterBacklog = async () => {
    const agora = Date.now();
    if (backlogCache && agora - backlogCacheAtualizadoEm < C.BACKLOG_CACHE_TTL_MS) return backlogCache;
    const url = `https://docs.google.com/spreadsheets/d/${C.BACKLOG_SHEET_ID}/export?format=csv&gid=${C.BACKLOG_GID}`;
    const res = await axios.get(url, { timeout: 15000 });
    backlogCache = parse(res.data, { columns: true, skip_empty_lines: true, trim: true });
    backlogCacheAtualizadoEm = agora;
    return backlogCache;
};

const makeForarotaKey = (bairro) => `${C.BACKLOG_SHEET_ID}|gid=${C.BACKLOG_GID}|bairro=${normalizeText(bairro)}`;

const pickNextBacklogForarota = async (bairro, qtd) => {
    const rows = await obterBacklog();
    const filtered = rows.map(r => {
        const contrato = normalizeSpaces(getField(r, ['CONTRATO', 'Contrato']));
        const nome = normalizeSpaces(getField(r, ['NOME', 'Nome']));
        const endereco = normalizeSpaces(getField(r, ['ENDEREÇO', 'ENDERECO', 'Endereco']));
        const bairroCol = normalizeSpaces(getField(r, ['BAIRRO', 'Bairro']));
        const telefonesRaw = getField(r, ['TELEFONES', 'Telefones', 'TELEFONE', 'Telefone']);

        if (!contrato || contrato.includes('#') || normalizeText(contrato).includes('n/d')) return null;
        if (!nome || nome.includes('#') || normalizeText(nome).includes('n/d')) return null;
        if (!endereco || endereco.includes('#') || normalizeText(endereco).includes('n/d')) return null;

        return { contrato, nome, endereco, bairro: bairroCol, phones: extractPhones(telefonesRaw) };
    }).filter(Boolean).filter(r => normalizeText(r.bairro) === normalizeText(bairro));

    const stateObj = safeReadJson(C.FORAROTA_STATE_FILE, {});
    const key = makeForarotaKey(bairro);
    if (!stateObj[key]) stateObj[key] = { usedContratos: [], updatedAt: null };
    
    const usedSet = new Set((stateObj[key].usedContratos || []).map(String));
    const picked = [];

    for (const r of filtered) {
        if (!usedSet.has(String(r.contrato))) {
            picked.push(r);
            usedSet.add(String(r.contrato));
            if (picked.length >= qtd) break;
        }
    }

    if (picked.length > 0) {
        stateObj[key].usedContratos = Array.from(usedSet);
        stateObj[key].updatedAt = new Date().toISOString();
        safeWriteJsonAtomic(C.FORAROTA_STATE_FILE, stateObj);
    }

    return {
        picked,
        totalFiltro: filtered.length,
        jaEnviadosAntes: usedSet.size - picked.length,
        enviadosAgora: picked.length,
        totalEnviados: usedSet.size,
        restantes: Math.max(filtered.length - usedSet.size, 0),
        key
    };
};

module.exports = { obterBaseContratos, pickNextBacklogForarota, obterBacklog, makeForarotaKey };
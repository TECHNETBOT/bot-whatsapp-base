// src/data.js
const { safeReadJson, safeWriteJsonAtomic, normalizeJid } = require('./utils');
const C = require('./config');

// === CACHE LID ===
let LID_CACHE = safeReadJson(C.ARQ_LID_CACHE, {});
const salvarLidCache = () => safeWriteJsonAtomic(C.ARQ_LID_CACHE, LID_CACHE);

// === DONOS ===
let DONOS_SET = new Set();
const carregarDonos = () => {
    const data = safeReadJson(C.ARQ_DONOS, null);
    if (!data || !Array.isArray(data.donos)) {
        safeWriteJsonAtomic(C.ARQ_DONOS, { donos: [] });
        DONOS_SET = new Set();
    } else {
        DONOS_SET = new Set(data.donos.filter(Boolean));
    }
};
const salvarDonos = () => safeWriteJsonAtomic(C.ARQ_DONOS, { donos: Array.from(DONOS_SET).sort() });

const isDono = (usuarioId) => {
    if (DONOS_SET.size === 0) return false;
    if (DONOS_SET.has(usuarioId)) return true;
    const userDigits = normalizeJid(usuarioId);
    for (const dono of DONOS_SET) {
        if (userDigits === normalizeJid(dono) && userDigits.length >= 10) return true;
    }
    return false;
};

// === GRUPOS ===
let GRUPOS_AUTORIZADOS_SET = new Set();
const carregarGrupos = () => {
    const padrao = { grupos: [C.ID_GRUPO_ALERTAS, C.ID_TESTE_EXCLUSIVO, C.ID_GRUPO_TECNICOS] };
    const data = safeReadJson(C.ARQ_GRUPOS_AUTORIZADOS, null);
    if (!data || !Array.isArray(data.grupos)) {
        safeWriteJsonAtomic(C.ARQ_GRUPOS_AUTORIZADOS, padrao);
        GRUPOS_AUTORIZADOS_SET = new Set(padrao.grupos);
    } else {
        GRUPOS_AUTORIZADOS_SET = new Set(data.grupos);
    }
};
const salvarGrupos = () => safeWriteJsonAtomic(C.ARQ_GRUPOS_AUTORIZADOS, { grupos: Array.from(GRUPOS_AUTORIZADOS_SET).sort() });
const isGrupoAutorizado = (chatId) => GRUPOS_AUTORIZADOS_SET.has(chatId);

// === LISTAS VT/AD/DESC ===
let listaVT = safeReadJson(C.ARQUIVO_VT, []);
let listaAD = safeReadJson(C.ARQUIVO_AD, []);
let listaDESC = safeReadJson(C.ARQUIVO_DESC, []);

const salvarLista = (tipo) => {
    if (tipo === 'VT') safeWriteJsonAtomic(C.ARQUIVO_VT, listaVT);
    if (tipo === 'AD') safeWriteJsonAtomic(C.ARQUIVO_AD, listaAD);
    if (tipo === 'DESC') safeWriteJsonAtomic(C.ARQUIVO_DESC, listaDESC);
};

// Inicialização
carregarDonos();
carregarGrupos();

module.exports = {
    LID_CACHE, salvarLidCache,
    DONOS_SET, salvarDonos, isDono,
    GRUPOS_AUTORIZADOS_SET, salvarGrupos, isGrupoAutorizado,
    listaVT, listaAD, listaDESC, salvarLista
};
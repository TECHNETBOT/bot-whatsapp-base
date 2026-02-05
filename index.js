const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// IMPORTAÇÕES LOCAIS
const C = require('./src/config');
const Utils = require('./src/utils');
const Data = require('./src/data');
const Sheets = require('./src/sheets');
const Alerts = require('./src/alerts');
// [NOVO] Importando o gerador de comprovante
const { gerarComprovanteDevolucao } = require('./src/gerador');

const esperaConfirmacaoURA = new Map();
let ultimoAlertaEnviado = "";
let ultimoAlertaVT = "";
let ultimoAlertaAD = "";
let ultimoAlertaDESC = "";
let alertaIntervalId = null;
let sock;

// ==================== FUNÇÕES AUXILIARES DE MENSAGEM ====================
const formatForarotaCard = (row, tecnico) => {
  const tel = row.phones.length === 0 ? '' : row.phones.length === 1 ? row.phones[0] : `${row.phones[0]} ; ${row.phones[1]}`;
  return ['⭕ FORA ROTA ⭕', '', `CONTRATO: ${row.contrato}`, `NOME: ${row.nome}`, `END: ${row.endereco}`, `TEL: ${tel}`, `TECNICO: ${tecnico}`].join('\n');
};

const parseForarotaLines = (text) => {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    let parts = line.split('\t').map(p => p.trim()).filter(Boolean);
    if (parts.length < 4) parts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
    const contrato = parts[0] || ''; const nome = parts[1] || ''; const endereco = parts[2] || ''; const telefones = parts[parts.length - 1] || '';
    if (!contrato || !nome || !endereco) continue;
    rows.push({ contrato: Utils.normalizeSpaces(contrato), nome: Utils.normalizeSpaces(nome), endereco: Utils.normalizeSpaces(endereco), phones: Utils.extractPhones(telefones) });
  }
  return rows;
};

const validarNumero = async (chatId, numero, comandoExemplo) => {
  if (numero.length < 10) { await sock.sendMessage(chatId, { text: `❌ Número inválido. Use: ${comandoExemplo}` }); return false; }
  return true;
};

const adicionarNumeroLista = async (chatId, numero, lista, nomeLista, tipo, comandoExemplo) => {
    if (!(await validarNumero(chatId, numero, comandoExemplo))) return;
    if (lista.includes(numero)) { await sock.sendMessage(chatId, { text: `⚠️ O número *${numero}* já está na lista ${nomeLista}.` }); return; }
    lista.push(numero);
    Data.salvarLista(tipo);
    await sock.sendMessage(chatId, { text: `✅ *${nomeLista}* - Número *${numero}* adicionado!\n📋 Total: ${lista.length}` });
};

const removerNumeroLista = async (chatId, numero, lista, nomeLista, tipo) => {
    const index = lista.indexOf(numero);
    if (index === -1) { await sock.sendMessage(chatId, { text: `⚠️ Número *${numero}* não está na lista ${nomeLista}.` }); return; }
    lista.splice(index, 1);
    Data.salvarLista(tipo);
    await sock.sendMessage(chatId, { text: `✅ *${nomeLista}* - Número *${numero}* removido!\n📋 Total: ${lista.length}` });
};

const listarNumeros = async (chatId, lista, nomeLista) => {
    if (lista.length === 0) { await sock.sendMessage(chatId, { text: `📋 *${nomeLista}* - Nenhum controlador cadastrado.` }); return; }
    let resposta = `📋 *CONTROLADORES ${nomeLista}:*\n\n`;
    lista.forEach((num, i) => { resposta += `${i + 1}. ${num}\n`; });
    resposta += `\n✅ Total: ${lista.length}`;
    await sock.sendMessage(chatId, { text: resposta });
};

async function exibirDadosContrato(chatId, encontrado, termoBusca, message) {
  let resposta = '';
  if (chatId === C.ID_GRUPO_TECNICOS) {
    resposta = `✅ *CONTATOS LIBERADOS* \n\n📄 *Contrato:* ${termoBusca}\n────────────────────\n`;
    if (encontrado['Telefone 1']) resposta += `📞 *Tel 1:* ${encontrado['Telefone 1']}\n`;
    if (encontrado['Telefone 2']) resposta += `📞 *Tel 2:* ${encontrado['Telefone 2']}\n`;
    if (encontrado['Telefone 3']) resposta += `📞 *Tel 3:* ${encontrado['Telefone 3']}\n`;
    resposta += `\nCaso não consiga contato o cliente, por favor retornar para o controlador com evidências(foto,video...)`;
  } else {
    resposta = `📄 *Contrato:* ${termoBusca}\n────────────────────\n`;
    if (encontrado['Telefone 1']) resposta += `📞 *Tel 1:* ${encontrado['Telefone 1']}\n`;
    if (encontrado['Telefone 2']) resposta += `📞 *Tel 2:* ${encontrado['Telefone 2']}\n`;
    if (encontrado['Telefone 3']) resposta += `📞 *Tel 3:* ${encontrado['Telefone 3']}`;
  }
  await sock.sendMessage(chatId, { text: resposta }, { quoted: message });
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_baileys');
  sock = makeWASocket({
    auth: state, printQRInTerminal: false, logger: pino({ level: 'fatal' }),
    browser: ['Bot Consulta', 'Chrome', '1.0.0'], markOnlineOnConnect: false
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { console.log('\n🔸 Escaneie o QR Code abaixo:\n'); qrcode.generate(qr, { small: true }); }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
      console.log('⚠️ Conexão fechada, reconectando...', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('--- BOT CONSULTA ATIVO (MODULAR + GERADOR) ---');
      console.log(`📋 VT: ${Data.listaVT.length} | AD: ${Data.listaAD.length} | DESC: ${Data.listaDESC.length}`);
      if (alertaIntervalId) clearInterval(alertaIntervalId);

      alertaIntervalId = setInterval(() => {
        const agora = new Date();
        const horaAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
        
        const horariosAlertaTec1 = { "11:45": "das 08h às 12h", "14:45": "das 12h às 15h", "17:45": "das 15h às 18h" };
        if (horariosAlertaTec1[horaAtual] && ultimoAlertaEnviado !== horaAtual) { Alerts.enviarAlertaJanela(sock, horariosAlertaTec1[horaAtual], C.ID_GRUPO_ALERTAS); ultimoAlertaEnviado = horaAtual; }

        const horariosAlertaVT = { "09:45": ["08:00 às 10:00"], "10:45": ["08:00 às 11:00"], "11:45": ["10:00 às 12:00"], "13:45": ["11:00 às 14:00", "12:00 às 14:00"], "15:45": ["14:00 às 16:00"], "16:45": ["14:00 às 17:00"], "17:45": ["16:00 às 18:00"], "19:45": ["17:00 às 20:00", "18:00 às 20:00"] };
        if (horariosAlertaVT[horaAtual] && ultimoAlertaVT !== horaAtual) { Alerts.enviarAlertaGenerico(sock, { titulo: 'VISITA TÉCNICA (VT)', janelas: horariosAlertaVT[horaAtual], idDestino: C.ID_GRUPO_ALERTAS, lista: Data.listaVT, logPrefixo: 'VT' }); ultimoAlertaVT = horaAtual; }

        const horariosAlertaAD = { "11:45": ["08:00 às 12:00"], "14:45": ["12:00 às 15:00"], "17:45": ["15:00 às 18:00"] };
        if (horariosAlertaAD[horaAtual] && ultimoAlertaAD !== horaAtual) { Alerts.enviarAlertaGenerico(sock, { titulo: 'ADESÃO', janelas: horariosAlertaAD[horaAtual], idDestino: C.ID_GRUPO_ALERTAS, lista: Data.listaAD, logPrefixo: 'ADESÃO' }); ultimoAlertaAD = horaAtual; }
      }, 30000);
    }
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    try {
      const m = messages[0];
      if (type !== 'notify' || m.key.fromMe) return;
      const msgTextoRaw = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
      const msgTexto = msgTextoRaw.toLowerCase().trim();
      const chatId = m.key.remoteJid;
      let usuarioId = m.key.participant || chatId;
      const isGrupo = chatId.endsWith('@g.us');
      const isGrupoAutorizado = Data.isGrupoAutorizado(chatId);

      // --- TRATAMENTO DE LID ---
      if (usuarioId.includes('@lid') && isGrupo) {
        if (!Data.LID_CACHE[usuarioId]) {
          try {
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === usuarioId || p.lid === usuarioId);
            if (participant) {
              Data.LID_CACHE[usuarioId] = { lid: usuarioId, jid: participant.id || '', groupId: chatId, savedAt: new Date().toISOString() };
              Data.salvarLidCache();
            }
          } catch (err) {}
        }
        try { // Tenta usar o ID real se disponível
          const groupMetadata = await sock.groupMetadata(chatId);
          const participant = groupMetadata.participants.find(p => p.id === usuarioId);
          if (participant && participant.id) usuarioId = participant.id;
        } catch (err) {}
      }

      // ==================== GERADOR DE COMPROVANTE (DEVOLUÇÃO) ====================
      // Verifica se o texto tem as chaves "Nome do Técnico:" e "Numero serial:"
      if (msgTextoRaw.includes('Nome do Técnico:') && msgTextoRaw.includes('Numero serial:')) {
          try {
              // Funçãozinha simples para extrair o valor de cada linha
              const extrairValor = (chave) => {
                  const linhas = msgTextoRaw.split('\n');
                  const linha = linhas.find(l => l.toLowerCase().includes(chave.toLowerCase()));
                  if (linha) {
                      const partes = linha.split(':');
                      if (partes.length > 1) return partes.slice(1).join(':').trim();
                  }
                  return '';
              };

              const data = extrairValor('Data');
              const contrato = extrairValor('Contrato');
              const nomeCliente = extrairValor('Nome do cliente');
              const serials = extrairValor('Numero serial');
              const tecnico = extrairValor('Nome do Técnico');

              if (!contrato || !serials) {
                   await sock.sendMessage(chatId, { text: '⚠️ Faltou o Contrato ou Serial para gerar o comprovante.' }, { quoted: m });
                   return;
              }

              // Avisar que está gerando
              await sock.sendMessage(chatId, { react: { text: '⏳', key: m.key } });

              // Gerar a imagem
              const bufferImagem = await gerarComprovanteDevolucao({ data, contrato, nomeCliente, serials, tecnico });

              // Enviar a imagem
              await sock.sendMessage(chatId, { 
                  image: bufferImagem, 
                  caption: `✅ Comprovante de Devolução Gerado.\nCliente: ${nomeCliente}` 
              }, { quoted: m });

          } catch (err) {
              console.error('Erro ao gerar comprovante:', err);
              await sock.sendMessage(chatId, { text: '❌ Erro ao gerar a imagem.' }, { quoted: m });
          }
          return; // Para não processar como outro comando
      }

      // === COMANDOS ===
      if (msgTexto === '!id') { await sock.sendMessage(chatId, { text: `🆔 Chat: ${chatId}\n👤 User: ${usuarioId}` }, { quoted: m }); return; }
      
      // -- Donos --
      if (msgTexto.startsWith('!adddono')) {
          const partes = msgTextoRaw.trim().split(/\s+/);
          const num = partes[1];
          if (Data.DONOS_SET.size === 0) { // Bootstrap
              Data.DONOS_SET.add(usuarioId);
              const numExtracted = Utils.normalizeDigits(usuarioId);
              if (numExtracted.length >= 10) { const jid = Utils.toOwnerJid(numExtracted); if(jid) Data.DONOS_SET.add(jid); }
              Data.salvarDonos();
              await sock.sendMessage(chatId, { text: '👑 Bootstrap OK. Você é dono.' }, { quoted: m });
              if (num) { 
                const jid = Utils.toOwnerJid(num); 
                if (jid && !Data.DONOS_SET.has(jid) && Utils.normalizeDigits(jid).length >= 12) {
                    Data.DONOS_SET.add(jid); Data.salvarDonos();
                } 
              }
              return;
          }
          if (!Data.isDono(usuarioId)) { await sock.sendMessage(chatId, { text: '❌ Sem permissão.' }, { quoted: m }); return; }
          const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.participant;
          if (quotedMsg) {
             if (Data.DONOS_SET.has(quotedMsg)) return;
             Data.DONOS_SET.add(quotedMsg); Data.salvarDonos();
             await sock.sendMessage(chatId, { text: `✅ Dono via LID: ${quotedMsg}` }, { quoted: m }); return;
          }
          if (!num) return;
          const jid = Utils.toOwnerJid(num);
          if (!jid || Utils.normalizeDigits(jid).length < 12) return;
          if (Data.DONOS_SET.has(jid)) return;
          Data.DONOS_SET.add(jid); Data.salvarDonos();
          await sock.sendMessage(chatId, { text: `✅ Dono adicionado: ${jid}` }, { quoted: m }); return;
      }
      
      if (msgTexto === '!addme' && Data.isDono(usuarioId) && !Data.DONOS_SET.has(usuarioId)) { Data.DONOS_SET.add(usuarioId); Data.salvarDonos(); await sock.sendMessage(chatId, { text: '✅ Adicionado.' }, { quoted: m }); return; }
      if (msgTexto === '!listadonos' && Data.isDono(usuarioId)) { await sock.sendMessage(chatId, { text: Array.from(Data.DONOS_SET).join('\n') }, { quoted: m }); return; }
      
      // -- Grupos --
      if (msgTexto === '!addgrupo' && isGrupo && Data.isDono(usuarioId)) { Data.GRUPOS_AUTORIZADOS_SET.add(chatId); Data.salvarGrupos(); await sock.sendMessage(chatId, { text: '✅ Grupo autorizado.' }, { quoted: m }); return; }
      if (msgTexto === '!removergrupo' && isGrupo && Data.isDono(usuarioId)) { Data.GRUPOS_AUTORIZADOS_SET.delete(chatId); Data.salvarGrupos(); await sock.sendMessage(chatId, { text: '✅ Grupo removido.' }, { quoted: m }); return; }

      // -- Menu --
      if (isGrupoAutorizado && (msgTexto === '!comandos' || msgTexto === '!help' || msgTexto === '!ajuda')) {
          await sock.sendMessage(chatId, { text: '📋 *MENU*\n!id, !adddono, !listadonos, !addgrupo\n!forarota "Tec" "Bairro" "Qtd"\n!forarota-status "Bairro"\n!addvt / !addad / !adddesc\n!teste...' }); return;
      }

      if (!isGrupoAutorizado) return;

      // -- Fora Rota --
      if (msgTexto.startsWith('!forarota ') || msgTexto === '!forarota') {
          const args = Utils.parseQuotedArgs(msgTextoRaw);
          const [_, tecnico, bairro, qtdStr] = args;
          if (!tecnico || !bairro || !qtdStr) { await sock.sendMessage(chatId, { text: '❌ Use: !forarota "Tec" "Bairro" "Qtd"' }, { quoted: m }); return; }
          if (!fs.existsSync(C.FORAROTA_STATE_FILE)) Utils.safeWriteJsonAtomic(C.FORAROTA_STATE_FILE, {});
          try {
              const result = await Sheets.pickNextBacklogForarota(bairro, parseInt(qtdStr.replace(/\D/g, '')));
              if (result.picked.length === 0) { await sock.sendMessage(chatId, { text: '⚠️ Nada encontrado.' }, { quoted: m }); return; }
              for (const r of result.picked) { await sock.sendMessage(chatId, { text: formatForarotaCard(r, tecnico) }, { quoted: m }); await Utils.sleep(C.FORAROTA_DELAY_MS); }
              await sock.sendMessage(chatId, { text: `✅ Enviados: ${result.enviadosAgora}\nRestantes: ${result.restantes}` }, { quoted: m });
          } catch(e) { await sock.sendMessage(chatId, { text: 'Erro na planilha.' }, { quoted: m }); }
          return;
      }
      
      // -- Manual Raw --
      if (msgTexto.startsWith('!forarota-raw')) {
         const after = msgTextoRaw.replace(/^!forarota-raw/i, '').trim();
         const firstSpace = after.indexOf(' ');
         const tecnico = (firstSpace === -1 ? after : after.slice(0, firstSpace)).trim();
         let payload = (firstSpace === -1 ? '' : after.slice(firstSpace + 1)).trim();
         if (!payload && msgTextoRaw.split('\n').length > 1) payload = msgTextoRaw.split('\n').slice(1).join('\n').trim();
         const rows = parseForarotaLines(payload);
         for (const r of rows) { await sock.sendMessage(chatId, { text: formatForarotaCard(r, tecnico) }, { quoted: m }); await Utils.sleep(C.FORAROTA_DELAY_MS); }
         return;
      }

      // -- Listas VT/AD/DESC --
      if (msgTexto.startsWith('!addvt ')) await adicionarNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(7)), Data.listaVT, 'VT', 'VT', '!addvt 5584...');
      if (msgTexto.startsWith('!unaddvt ')) await removerNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(9)), Data.listaVT, 'VT', 'VT');
      if (msgTexto === '!listavt') await listarNumeros(chatId, Data.listaVT, 'VT');

      if (msgTexto.startsWith('!addad ')) await adicionarNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(7)), Data.listaAD, 'ADESÃO', 'AD', '!addad 5584...');
      if (msgTexto.startsWith('!unaddad ')) await removerNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(9)), Data.listaAD, 'ADESÃO', 'AD');
      if (msgTexto === '!listaad') await listarNumeros(chatId, Data.listaAD, 'ADESÃO');

      if (msgTexto.startsWith('!adddesc ')) await adicionarNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(9)), Data.listaDESC, 'DESC', 'DESC', '!adddesc 5584...');
      if (msgTexto.startsWith('!unadddesc ')) await removerNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(11)), Data.listaDESC, 'DESC', 'DESC');
      if (msgTexto === '!listadesc') await listarNumeros(chatId, Data.listaDESC, 'DESCONEXÃO');

      // -- Testes --
      if (msgTexto === '!testevt') await Alerts.enviarAlertaGenerico(sock, { titulo: 'VISITA TÉCNICA (VT)', janelas: ['Teste Janela'], idDestino: chatId, lista: Data.listaVT, logPrefixo: 'VT-TESTE' });

      // -- URA --
      if (esperaConfirmacaoURA.has(usuarioId)) {
          const dados = esperaConfirmacaoURA.get(usuarioId);
          if (msgTexto === 'sim') { await exibirDadosContrato(chatId, dados.dados, dados.termo, m); esperaConfirmacaoURA.delete(usuarioId); return; }
          if (msgTexto === 'não' || msgTexto === 'nao') { await sock.sendMessage(chatId, { text: "Valide na URA." }, { quoted: m }); esperaConfirmacaoURA.delete(usuarioId); return; }
      }

      // -- Busca Contrato --
      const match = msgTexto.match(/(?:cct|cont|contato|contatos|contrato)\D*(\d+)|(\d+)\D*(?:cct|cont|contato|contatos|contrato)/i);
      if (match) {
          const termo = match[1] || match[2];
          try {
              const base = await Sheets.obterBaseContratos(); // Aqui já vem sem duplicatas!
              const achado = base.find(r => r['Contrato'] === termo);
              if (achado) {
                  if (chatId === C.ID_GRUPO_TECNICOS) {
                      esperaConfirmacaoURA.set(usuarioId, { termo, dados: achado, messageKey: m.key });
                      await sock.sendMessage(chatId, { text: `📄 *Contrato:* ${termo}\nJá confirmou com a URA? (Sim/Não)` }, { quoted: m });
                  } else {
                      await exibirDadosContrato(chatId, achado, termo, m);
                  }
              } else {
                  if (chatId === C.ID_GRUPO_TECNICOS) await sock.sendMessage(chatId, { text: "❌ Não encontrado." }, { quoted: m });
                  else if (chatId === C.ID_GRUPO_ALERTAS) await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
              }
          } catch (e) { console.error(e); }
      }

    } catch (e) { console.error('Erro msg:', e); }
  });
  return sock;
}
connectToWhatsApp();
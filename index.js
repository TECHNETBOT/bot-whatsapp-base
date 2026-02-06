const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
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
const { gerarComprovanteDevolucao } = require('./src/gerador');
const { lerTextoDeImagem } = require('./src/ocr'); 
const { processarMensagemPonto, gerarRelatorioDia, gerarRelatorioCSV } = require('./src/ponto');

// ID DO GRUPO DE TESTE
const ID_GRUPO_TESTE = '120363423496684075@g.us';

const esperaConfirmacaoURA = new Map();
let ultimoAlertaEnviado = "";
let ultimoAlertaVT = "";
let ultimoAlertaAD = "";
let alertaIntervalId = null;
let sock;

// ==================== FUNÇÕES AUXILIARES ====================
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
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('--- BOT ATIVO (ORDEM FIXA SÓ HORÁRIOS) ---');
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
      const msgTextoRaw = m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || '';
      const msgTexto = msgTextoRaw.toLowerCase().trim();
      const msgTextoSemAcento = msgTexto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const chatId = m.key.remoteJid;
      let usuarioId = m.key.participant || chatId;
      const nomeUsuario = m.key.participant ? m.pushName : null; 
      const isGrupo = chatId.endsWith('@g.us');
      const isGrupoAutorizado = Data.isGrupoAutorizado(chatId) || chatId === ID_GRUPO_TESTE;

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
        try { const groupMetadata = await sock.groupMetadata(chatId); const participant = groupMetadata.participants.find(p => p.id === usuarioId); if (participant && participant.id) usuarioId = participant.id; } catch (err) {}
      }

      // ==================== PONTO ELETRÔNICO ====================
      if (isGrupoAutorizado && msgTextoRaw.length > 0 && msgTextoRaw.length < 200) { 
          const resultadoPonto = processarMensagemPonto(nomeUsuario, msgTextoRaw, m.messageTimestamp);
          if (resultadoPonto) {
              await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
              console.log(`⏰ Ponto: ${resultadoPonto.nome} (${resultadoPonto.horario})`);
          }
      }

      // ==================== COMANDOS DO PONTO ====================
      if (msgTexto === '!controlador') {
          if (!isGrupoAutorizado) return;
          const relatorio = gerarRelatorioDia();
          await sock.sendMessage(chatId, { text: relatorio }, { quoted: m });
          return;
      }

      if (msgTexto === '!planilha') {
          if (!isGrupoAutorizado) return;
          const csv = gerarRelatorioCSV();
          await sock.sendMessage(chatId, { 
              text: `📋 *HORÁRIOS DO DIA*\n\n_Copie o bloco abaixo e cole na coluna "INICIO EXP."_\n\n\`\`\`${csv}\`\`\`` 
          }, { quoted: m });
          return;
      }

      // ==================== OCR (LEITURA DE FOTO) ====================
      const isImage = m.message?.imageMessage;
      const isQuotedImage = m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      
      if (msgTexto === '!ler') {
          let buffer = null;
          if (isImage) {
              console.log('📸 Baixando imagem da mensagem direta...');
              buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
          } else if (isQuotedImage) {
              console.log('📸 Baixando imagem da mensagem respondida...');
              const msgCitada = {
                  message: m.message.extendedTextMessage.contextInfo.quotedMessage,
                  key: { id: m.message.extendedTextMessage.contextInfo.stanzaId, remoteJid: chatId, participant: m.message.extendedTextMessage.contextInfo.participant }
              };
              buffer = await downloadMediaMessage(msgCitada, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
          }

          if (buffer) {
              await sock.sendMessage(chatId, { react: { text: '👀', key: m.key } });
              const resultado = await lerTextoDeImagem(buffer);
              if (resultado && resultado.codigos.length > 0) {
                  let resposta = `📠 *CÓDIGOS ENCONTRADOS:*\n`;
                  resultado.codigos.forEach(c => { resposta += `\n🏷️ *${c.tipo}:* ${c.valor}`; });
                  resposta += `\n\n_Copie o código desejado._`;
                  await sock.sendMessage(chatId, { text: resposta }, { quoted: m });
              } else if (resultado && resultado.raw) {
                   await sock.sendMessage(chatId, { text: `⚠️ Não identifiquei códigos padrão, mas li isto:\n\n${resultado.raw.slice(0, 500)}...` }, { quoted: m });
              } else {
                  await sock.sendMessage(chatId, { text: '❌ Não consegui ler nada na imagem.' }, { quoted: m });
              }
          } else {
             if (!isImage && !isQuotedImage) await sock.sendMessage(chatId, { text: '❌ Responda a uma foto com !ler.' }, { quoted: m });
          }
          return;
      }

      // ==================== GERADOR DE COMPROVANTE ====================
      if (msgTextoSemAcento.includes('tecnico') && (msgTextoSemAcento.includes('serial') || msgTextoSemAcento.includes('equipamento'))) {
          console.log('📝 Pedido de comprovante detectado!');
          try {
              const extrairValor = (chave) => {
                  const chaveClean = chave.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                  const linhas = msgTextoRaw.split('\n');
                  const linha = linhas.find(l => l.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(chaveClean));
                  if (linha) {
                      const partes = linha.split(':');
                      if (partes.length > 1) return partes.slice(1).join(':').trim();
                  }
                  return '';
              };

              const data = extrairValor('Data');
              const contrato = extrairValor('Contrato');
              const nomeCliente = extrairValor('Nome do cliente');
              const tecnico = extrairValor('Nome do Técnico');
              let rawEquips = extrairValor('Equipamentos') || extrairValor('Numero serial');

              if (!contrato || !rawEquips) { await sock.sendMessage(chatId, { text: '⚠️ Faltou o Contrato ou os Equipamentos.' }, { quoted: m }); return; }

              const palavrasChave = ['EMTA', 'DECODE', 'SMART', 'MASH', 'HGU', 'ONT', 'APARELHO'];
              const listaEquipamentosProcessada = rawEquips.split(',').map(item => {
                  let itemLimpo = item.trim().toUpperCase();
                  for (const modelo of palavrasChave) {
                      if (itemLimpo.startsWith(modelo)) {
                          let serialSobra = itemLimpo.substring(modelo.length).replace(/^[:;\s-]+/, '').trim();
                          if (serialSobra) return { modelo: modelo, serial: serialSobra };
                      }
                  }
                  if (itemLimpo.includes(':')) {
                      const parts = itemLimpo.split(':');
                      return { modelo: parts[0].trim(), serial: parts.slice(1).join(':').trim() };
                  } else {
                      return { modelo: 'APARELHO', serial: itemLimpo };
                  }
              }).filter(i => i.serial);

              if (listaEquipamentosProcessada.length === 0) { await sock.sendMessage(chatId, { text: '⚠️ Nenhum serial válido.' }, { quoted: m }); return; }

              await sock.sendMessage(chatId, { react: { text: '⏳', key: m.key } });
              const bufferImagem = await gerarComprovanteDevolucao({ data, contrato, nomeCliente, equipamentos: listaEquipamentosProcessada, tecnico });
              await sock.sendMessage(chatId, { image: bufferImagem, caption: `✅ Comprovante Gerado.\nCliente: ${nomeCliente}` }, { quoted: m });
          } catch (err) {
              console.error('Erro comprovante:', err);
              await sock.sendMessage(chatId, { text: '❌ Erro ao gerar imagem.' }, { quoted: m });
          }
          return;
      }

      // === COMANDOS NORMAIS ===
      if (msgTexto === '!id') { await sock.sendMessage(chatId, { text: `🆔 Chat: ${chatId}\n👤 User: ${usuarioId}` }, { quoted: m }); return; }
      
      // -- Donos e Grupos --
      if (msgTexto.startsWith('!adddono')) {
          const num = msgTextoRaw.trim().split(/\s+/)[1];
          if (Data.DONOS_SET.size === 0) {
              Data.DONOS_SET.add(usuarioId);
              const numExtracted = Utils.normalizeDigits(usuarioId);
              if (numExtracted.length >= 10) { const jid = Utils.toOwnerJid(numExtracted); if(jid) Data.DONOS_SET.add(jid); }
              Data.salvarDonos();
              await sock.sendMessage(chatId, { text: '👑 Bootstrap OK.' }, { quoted: m });
              if (num) { const jid = Utils.toOwnerJid(num); if (jid && !Data.DONOS_SET.has(jid)) { Data.DONOS_SET.add(jid); Data.salvarDonos(); } }
              return;
          }
          if (!Data.isDono(usuarioId)) return;
          const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.participant;
          if (quotedMsg) { Data.DONOS_SET.add(quotedMsg); Data.salvarDonos(); await sock.sendMessage(chatId, { text: '✅ Dono add.' }, { quoted: m }); return; }
          if (num) { const jid = Utils.toOwnerJid(num); Data.DONOS_SET.add(jid); Data.salvarDonos(); await sock.sendMessage(chatId, { text: '✅ Dono add.' }, { quoted: m }); }
          return;
      }
      if (msgTexto === '!listadonos' && Data.isDono(usuarioId)) { await sock.sendMessage(chatId, { text: Array.from(Data.DONOS_SET).join('\n') }, { quoted: m }); return; }
      if (msgTexto === '!addgrupo' && chatId.endsWith('@g.us') && Data.isDono(usuarioId)) { Data.GRUPOS_AUTORIZADOS_SET.add(chatId); Data.salvarGrupos(); await sock.sendMessage(chatId, { text: '✅ Grupo autorizado.' }, { quoted: m }); return; }
      
      if (!isGrupoAutorizado) return; // BLOQUEIO DE SEGURANÇA

      // -- Listas e Comandos --
      if (msgTexto.startsWith('!addvt ')) await adicionarNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(7)), Data.listaVT, 'VT', 'VT', '!addvt 5584...');
      if (msgTexto.startsWith('!unaddvt ')) await removerNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(9)), Data.listaVT, 'VT', 'VT');
      if (msgTexto === '!listavt') await listarNumeros(chatId, Data.listaVT, 'VT');
      
      if (msgTexto.startsWith('!addad ')) await adicionarNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(7)), Data.listaAD, 'ADESÃO', 'AD', '!addad 5584...');
      if (msgTexto.startsWith('!unaddad ')) await removerNumeroLista(chatId, Utils.normalizeDigits(msgTextoRaw.slice(9)), Data.listaAD, 'ADESÃO', 'AD');
      if (msgTexto === '!listaad') await listarNumeros(chatId, Data.listaAD, 'ADESÃO');

      // -- Busca Contrato --
      const match = msgTexto.match(/(?:cct|cont|contato|contatos|contrato)\D*(\d+)|(\d+)\D*(?:cct|cont|contato|contatos|contrato)/i);
      if (match) {
          const termo = match[1] || match[2];
          try {
              const base = await Sheets.obterBaseContratos();
              const achado = base.find(r => r['Contrato'] === termo);
              if (achado) {
                  if (chatId === C.ID_GRUPO_TECNICOS) {
                      esperaConfirmacaoURA.set(usuarioId, { termo, dados: achado, messageKey: m.key });
                      await sock.sendMessage(chatId, { text: `📄 *Contrato:* ${termo}\nJá confirmou com a URA? (Sim/Não)` }, { quoted: m });
                  } else { await exibirDadosContrato(chatId, achado, termo, m); }
              } else {
                  if (chatId === C.ID_GRUPO_TECNICOS) await sock.sendMessage(chatId, { text: "❌ Não encontrado." }, { quoted: m });
              }
          } catch (e) { console.error(e); }
      }
      
      // -- URA --
      if (esperaConfirmacaoURA.has(usuarioId)) {
          const dados = esperaConfirmacaoURA.get(usuarioId);
          if (msgTexto === 'sim') { await exibirDadosContrato(chatId, dados.dados, dados.termo, m); esperaConfirmacaoURA.delete(usuarioId); return; }
          if (msgTexto === 'não' || msgTexto === 'nao') { await sock.sendMessage(chatId, { text: "Valide na URA." }, { quoted: m }); esperaConfirmacaoURA.delete(usuarioId); return; }
      }

    } catch (e) { console.error('Erro msg:', e); }
  });
  return sock;
}
connectToWhatsApp();
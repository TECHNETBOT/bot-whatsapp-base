// src/gerador.js
const { registerFont, createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');

// Função auxiliar para desenhar linhas
function drawLine(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

// Função auxiliar para centralizar texto
function drawCenteredText(ctx, text, x, y, width) {
    const textWidth = ctx.measureText(text).width;
    const startX = x + (width - textWidth) / 2;
    ctx.fillText(text, startX, y);
}

const gerarComprovanteDevolucao = async (dados) => {
    // Configurações do Canvas (Tamanho A4 aproximado em pixels para boa qualidade)
    const width = 1240;
    const height = 1754; 
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Fundo Branco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Carregar Logos
    try {
        const pathTechnet = path.join(__dirname, 'assets', 'technet.png');
        const pathClaro = path.join(__dirname, 'assets', 'claro.png');
        
        if (fs.existsSync(pathTechnet)) {
            const logoTechnet = await loadImage(pathTechnet);
            // Ajustar tamanho e posição Technet (Esquerda)
            ctx.drawImage(logoTechnet, 50, 40, 250, 80); 
        }

        if (fs.existsSync(pathClaro)) {
            const logoClaro = await loadImage(pathClaro);
            // Ajustar tamanho e posição Claro (Direita)
            ctx.drawImage(logoClaro, width - 200, 30, 120, 120);
        }
    } catch (e) {
        console.error("Erro ao carregar logos:", e);
    }

    // 3. Textos do Cabeçalho
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('DEVOLUÇÃO DE EQUIPAMENTOS', width / 2, 120);

    ctx.font = '22px Arial';
    ctx.fillText('Em loja CLARO (TECHNET)', width / 2, 160);

    ctx.textAlign = 'left';
    ctx.font = '20px Arial';
    ctx.fillText('Produto / Empresa', 50, 200);
    
    // Checkbox
    ctx.font = '22px Arial';
    ctx.fillText('CLARO TV ( _ )   NET ( X )', 50, 240);

    // ==========================================
    // 4. TABELA 1: Contrato, Nome, Data
    // ==========================================
    const startY_Table1 = 280;
    const rowHeight = 40;
    
    // Configuração das colunas (larguras)
    // Total width útil = 1140 (50 padding left + 50 padding right)
    const col1_w = 200; // Contrato
    const col3_w = 200; // Data
    const col2_w = width - 100 - col1_w - col3_w; // Nome (restante)

    const t1_x1 = 50;
    const t1_x2 = t1_x1 + col1_w;
    const t1_x3 = t1_x2 + col2_w;
    const t1_x4 = t1_x3 + col3_w; // Final

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';

    // Linhas Horizontais Tabela 1
    drawLine(ctx, t1_x1, startY_Table1, t1_x4, startY_Table1); // Topo
    drawLine(ctx, t1_x1, startY_Table1 + rowHeight, t1_x4, startY_Table1 + rowHeight); // Meio
    drawLine(ctx, t1_x1, startY_Table1 + (rowHeight * 2), t1_x4, startY_Table1 + (rowHeight * 2)); // Fim

    // Linhas Verticais Tabela 1
    drawLine(ctx, t1_x1, startY_Table1, t1_x1, startY_Table1 + (rowHeight * 2));
    drawLine(ctx, t1_x2, startY_Table1, t1_x2, startY_Table1 + (rowHeight * 2));
    drawLine(ctx, t1_x3, startY_Table1, t1_x3, startY_Table1 + (rowHeight * 2));
    drawLine(ctx, t1_x4, startY_Table1, t1_x4, startY_Table1 + (rowHeight * 2));

    // Textos Tabela 1 (Headers)
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    drawCenteredText(ctx, 'Contrato', t1_x1, startY_Table1 + 28, col1_w);
    drawCenteredText(ctx, 'Nome do cliente', t1_x2, startY_Table1 + 28, col2_w);
    drawCenteredText(ctx, 'Data', t1_x3, startY_Table1 + 28, col3_w);

    // Textos Tabela 1 (Dados)
    ctx.font = '20px Arial';
    drawCenteredText(ctx, dados.contrato, t1_x1, startY_Table1 + rowHeight + 28, col1_w);
    drawCenteredText(ctx, dados.nomeCliente, t1_x2, startY_Table1 + rowHeight + 28, col2_w);
    drawCenteredText(ctx, dados.data, t1_x3, startY_Table1 + rowHeight + 28, col3_w);

    // ==========================================
    // 5. TABELA 2: Equipamentos
    // ==========================================
    const startY_Table2 = 380;
    
    // Cabeçalho da Tabela 2
    // Colunas: Modelo | Serial | Equipamento | Fonte | Controle | Cabos
    // Larguras
    const c2_1 = 250; // Modelo
    const c2_2 = 250; // Serial
    const c2_rest = (width - 100 - c2_1 - c2_2) / 4; // Outros 4 divididos iguais

    const tx1 = 50;
    const tx2 = tx1 + c2_1;
    const tx3 = tx2 + c2_2;
    const tx4 = tx3 + c2_rest;
    const tx5 = tx4 + c2_rest;
    const tx6 = tx5 + c2_rest;
    const tx7 = tx6 + c2_rest; // Final

    // Processar Seriais (separar por vírgula)
    const listaSeriais = dados.serials.split(',').map(s => s.trim()).filter(Boolean);
    // Garantir pelo menos 5 linhas vazias se não houver seriais suficientes, para ficar igual ao modelo
    const minRows = 8; 
    const totalRows = Math.max(listaSeriais.length, minRows);

    // Desenhar Cabeçalho Tabela 2
    drawLine(ctx, tx1, startY_Table2, tx7, startY_Table2); // Topo
    drawLine(ctx, tx1, startY_Table2 + rowHeight, tx7, startY_Table2 + rowHeight); // Abaixo Header

    // Linhas verticais do Header
    [tx1, tx2, tx3, tx4, tx5, tx6, tx7].forEach(x => {
        drawLine(ctx, x, startY_Table2, x, startY_Table2 + rowHeight);
    });

    // Texto Header Tabela 2
    ctx.font = 'bold 18px Arial';
    drawCenteredText(ctx, 'Modelo Equipamento', tx1, startY_Table2 + 26, c2_1);
    drawCenteredText(ctx, 'Número Serial', tx2, startY_Table2 + 26, c2_2);
    drawCenteredText(ctx, 'Equipamento', tx3, startY_Table2 + 26, c2_rest);
    drawCenteredText(ctx, 'Fonte', tx4, startY_Table2 + 26, c2_rest);
    drawCenteredText(ctx, 'Ctrl Remoto', tx5, startY_Table2 + 26, c2_rest);
    drawCenteredText(ctx, 'Cabos', tx6, startY_Table2 + 26, c2_rest);

    // Desenhar Linhas dos Dados
    ctx.font = '20px Arial';
    
    for (let i = 0; i < totalRows; i++) {
        const yLine = startY_Table2 + rowHeight + (i * rowHeight);
        const yText = yLine + 28;
        const yBottom = yLine + rowHeight;

        // Linha horizontal inferior desta row
        drawLine(ctx, tx1, yBottom, tx7, yBottom);

        // Linhas verticais desta row
        [tx1, tx2, tx3, tx4, tx5, tx6, tx7].forEach(x => {
            drawLine(ctx, x, yLine, x, yBottom);
        });

        // Preencher dados se existir serial
        if (i < listaSeriais.length) {
            const serialAtual = listaSeriais[i];
            
            // Modelo (Fixo conforme pedido)
            drawCenteredText(ctx, 'APARELHO', tx1, yText, c2_1);
            
            // Serial
            drawCenteredText(ctx, serialAtual, tx2, yText, c2_2);

            // Tracinhos nas outras colunas (conforme imagem modelo)
            drawCenteredText(ctx, '-', tx3, yText, c2_rest);
            drawCenteredText(ctx, '-', tx4, yText, c2_rest);
            drawCenteredText(ctx, '-', tx5, yText, c2_rest);
            drawCenteredText(ctx, '-', tx6, yText, c2_rest);
        }
    }

    // ==========================================
    // 6. Rodapé e Assinaturas
    // ==========================================
    const footerStartY = startY_Table2 + rowHeight + (totalRows * rowHeight) + 40;

    ctx.textAlign = 'left';
    ctx.font = '16px Arial';
    ctx.fillText('Declaro para os devidos fins que o(s) equipamento(s) acima foi(foram) devolvido(s) para a CLARO/NET conforme especificações.', 50, footerStartY);
    ctx.fillText('Estou ciente da taxa caso o(s) equipamento(s) e/ou acessório(s) esteja(m) danificado(s), inutilizado(s), ou não for(am) entregue(s).', 50, footerStartY + 30);

    // Linhas de Assinatura
    const signY = footerStartY + 150;
    
    // Assinatura Técnico (Esquerda)
    drawLine(ctx, 50, signY, 500, signY);
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    // Nome do técnico centralizado na linha dele
    drawCenteredText(ctx, dados.tecnico.toUpperCase(), 50, signY - 10, 450); 
    ctx.font = '16px Arial';
    ctx.fillText('Assinatura do Representante Loja/Technet', 275, signY + 25);

    // Assinatura Cliente (Direita)
    drawLine(ctx, width - 500, signY, width - 50, signY);
    ctx.fillText('Assinatura do cliente ou Preposto que fez a entrega', width - 275, signY + 25);


    return canvas.toBuffer();
};

module.exports = { gerarComprovanteDevolucao };
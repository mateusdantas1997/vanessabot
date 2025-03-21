const os = require('os');
const qrcode = require('qrcode-terminal');
const { Client, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
    delays: {
        entreVideos: 10000,
        entreAudios: 10000,
        digitacao: 5000, // Tempo de digitação ajustado para 2 segundos
        gravacao: 5000   // Tempo de gravação ajustado para 5 segundos
    },
    limites: {
        tentativasReconexao: 5,
        tamanhoMaximoMidia: 16 * 1024 * 1024
    }
};

// Logger System
class Logger {
    info(mensagem) {
        const timestamp = new Date().toISOString();
        console.log(`[INFO][${timestamp}] ${mensagem}`);
    }
    error(mensagem, erro = '') {
        const timestamp = new Date().toISOString();
        console.error(`[ERROR][${timestamp}] ${mensagem} ${erro}`);
    }
}

// State Manager
class GerenciadorEstado {
    constructor() {
        this.estadosUsuario = new Map();
        this.mensagensEnviadas = new Map();
        this.conversasFinalizadas = new Set();
        this.processandoMensagem = new Map(); // Novo: Rastrear se uma mensagem está sendo processada
    }

    estaProcessando(idUsuario) {
        return this.processandoMensagem.get(idUsuario) || false;
    }

    iniciarProcessamento(idUsuario) {
        this.processandoMensagem.set(idUsuario, true);
    }

    finalizarProcessamento(idUsuario) {
        this.processandoMensagem.set(idUsuario, false);
    }

    obterEstadoUsuario(idUsuario) {
        return this.estadosUsuario.get(idUsuario);
    }

    definirEstadoUsuario(idUsuario, estado) {
        this.estadosUsuario.set(idUsuario, estado);
    }

    mensagemJaEnviada(idUsuario, estagio) {
        return this.mensagensEnviadas.get(`${idUsuario}-${estagio}`);
    }

    marcarMensagemEnviada(idUsuario, estagio) {
        this.mensagensEnviadas.set(`${idUsuario}-${estagio}`, true);
    }

    conversaFinalizada(idUsuario) {
        return this.conversasFinalizadas.has(idUsuario);
    }

    finalizarConversa(idUsuario) {
        this.conversasFinalizadas.add(idUsuario);
    }

    limparEstadoUsuario(idUsuario) {
        this.estadosUsuario.delete(idUsuario);
        this.mensagensEnviadas.delete(idUsuario);
        this.conversasFinalizadas.delete(idUsuario);
    }
}

// Media Manager
class GerenciadorMidia {
    constructor(logger) {
        this.logger = logger;
    }

    async enviarMidia(client, msg, caminhoMidia, opcoes = {}) {
        try {
            if (!fs.existsSync(caminhoMidia)) {
                throw new Error(`Arquivo não encontrado: ${caminhoMidia}`);
            }
            const media = MessageMedia.fromFilePath(caminhoMidia);
            this.logger.info(`Enviando mídia: ${caminhoMidia}`);
            return await client.sendMessage(msg.from, media, opcoes);
        } catch (erro) {
            this.logger.error(`Erro ao enviar mídia: ${caminhoMidia}`, erro);
            throw erro;
        }
    }

    async enviarMultiplosVideos(client, msg, caminhoVideos, delayEntre = config.delays.entreVideos) {
        for (const caminhoVideo of caminhoVideos) {
            try {
                const opcoes = {};
                if (caminhoVideo === './video1.mp4' || caminhoVideo === './video2.mp4') {
                    opcoes.isViewOnce = true;
                }
                await this.enviarMidia(client, msg, caminhoVideo, opcoes);
                this.logger.info(`Vídeo enviado: ${caminhoVideo}`);
                if (caminhoVideos.indexOf(caminhoVideo) < caminhoVideos.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayEntre));
                }
            } catch (erro) {
                this.logger.error(`Erro ao enviar vídeo ${caminhoVideo}:`, erro);
            }
        }
    }
}

// Main WhatsApp Bot
class WhatsAppBot {
    constructor() {
        this.logger = new Logger();
        this.gerenciadorEstado = new GerenciadorEstado();
        this.gerenciadorMidia = new GerenciadorMidia(this.logger);
        this.chromePath = this.obterCaminhoChromeDriver();
        this.inicializarBot();
    }

    obterCaminhoChromeDriver() {
        const plataforma = os.platform();
        const caminhos = {
            win32: [
                path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
                path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
            ],
            darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
            linux: [
                '/usr/bin/google-chrome',
                '/usr/bin/chrome',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                '/snap/bin/google-chrome',
                '/opt/google/chrome/google-chrome',
                '/root/Projects/chatmilly/chrome-linux/chrome'
            ]
        };
        const possiveisCaminhos = caminhos[plataforma] || [];
        for (const caminhoBrowser of possiveisCaminhos) {
            try {
                if (fs.existsSync(caminhoBrowser)) {
                    return caminhoBrowser;
                }
            } catch (erro) {
                continue;
            }
        }
        throw new Error(`Chrome não encontrado para a plataforma: ${plataforma}`);
    }

    async inicializarBot() {
        try {
            this.client = new Client({
                puppeteer: {
                    executablePath: this.chromePath,
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--remote-debugging-port=9222',
                        '--max-memory=512M'
                    ]
                },
                webVersionCache: { type: 'none' },
                restartOnAuthFail: true
            });
            this.configurarHandlers();
            await this.client.initialize();
        } catch (erro) {
            this.logger.error('Erro ao inicializar o bot:', erro);
            process.exit(1);
        }
    }

    configurarHandlers() {
        this.client.on('qr', this.handleQR.bind(this));
        this.client.on('ready', this.handleReady.bind(this));
        this.client.on('auth_failure', this.handleAuthFailure.bind(this));
        this.client.on('disconnected', this.handleDisconnect.bind(this));
        this.client.on('message', this.handleMessage.bind(this));
        process.on('uncaughtException', this.handleUncaughtException.bind(this));
        process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
    }

    handleQR(qr) {
        qrcode.generate(qr, { small: true });
        this.logger.info('Novo QR Code gerado');
    }

    handleReady() {
        this.logger.info('WhatsApp conectado com sucesso');
    }

    handleAuthFailure(msg) {
        this.logger.error('Falha na autenticação:', msg);
        this.tentarReconexao('auth_failure');
    }

    handleDisconnect(reason) {
        this.logger.error('Desconectado:', reason);
        this.tentarReconexao(reason);
    }

    handleUncaughtException(erro) {
        this.logger.error('Erro não capturado:', erro);
    }

    handleUnhandledRejection(reason) {
        this.logger.error('Promessa rejeitada não tratada:', reason);
    }

    async handleMessage(msg) {
        try {
            if (!msg.from.endsWith('@c.us')) return;
            const idUsuario = msg.from;

            // Verificar se a conversa já foi finalizada
            if (this.gerenciadorEstado.conversaFinalizada(idUsuario)) {
                return;
            }

            // Verificar se já está processando uma mensagem para este usuário
            if (this.gerenciadorEstado.estaProcessando(idUsuario)) {
                this.logger.info(`Mensagem ignorada para ${idUsuario}: já está sendo processada.`);
                return;
            }

            // Marcar que está processando esta mensagem
            this.gerenciadorEstado.iniciarProcessamento(idUsuario);

            // Processar qualquer tipo de mensagem como resposta válida
            if (!this.gerenciadorEstado.obterEstadoUsuario(idUsuario)) {
                this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'initial');
                await this.processarProximoEstagio(idUsuario, msg, 'initial');
            } else {
                const estadoAtual = this.gerenciadorEstado.obterEstadoUsuario(idUsuario);
                await this.processarProximoEstagio(idUsuario, msg, estadoAtual);
            }

            // Finalizar o processamento da mensagem
            this.gerenciadorEstado.finalizarProcessamento(idUsuario);
        } catch (erro) {
            this.logger.error('Erro no processamento de mensagem:', erro);
        }
    }

    async processarProximoEstagio(idUsuario, msg, estagioAtual) {
        try {
            if (this.gerenciadorEstado.mensagemJaEnviada(idUsuario, estagioAtual)) {
                this.logger.info(`Mensagem já enviada para estágio ${estagioAtual}`);
                return;
            }
            const chat = await msg.getChat();
            await this.processarEstagio(idUsuario, msg, chat, estagioAtual);
        } catch (erro) {
            this.logger.error(`Erro ao processar estágio ${estagioAtual}:`, erro);
        }
    }

    async processarEstagio(idUsuario, msg, chat, estagio) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        try {
            switch (estagio) {
                case 'initial':
                    await this.processarEstagioInicial(idUsuario, msg, chat);
                    break;
                case 'waiting_preview':
                    await this.processarEstagioPreview(idUsuario, msg, chat);
                    break;
                case 'waiting_promise':
                    await this.processarEstagioPromise(idUsuario, msg, chat);
                    break;
                case 'waiting_for_price_response':
                    await this.processarEstagioPriceResponse(idUsuario, msg, chat);
                    break;
                case 'waiting_final_promise':
                    await this.processarEstagioFinalPromise(idUsuario, msg, chat);
                    break;
                case 'sending_link':
                    await this.processarEstagioSendingLink(idUsuario, msg, chat);
                    break;
                case 'waiting_before_audio7':
                    await this.processarEstagioBeforeAudio7(idUsuario, msg, chat);
                    break;
                case 'waiting_before_audio6':
                    await this.processarEstagioBeforeAudio6(idUsuario, msg, chat);
                    break;
                case 'waiting_before_audiofinal':
                    await this.processarRespostaUsuarioBeforeAudiofinal(idUsuario, msg, chat);
                    break;
                case 'waiting_after_audiofinal':
                    await this.processarEstagioAfterAudiofinal(idUsuario, msg, chat);
                    break;
                case 'waiting_after_audiofinal2':
                    await this.processarEstagioAfterAudiofinal2(idUsuario, msg, chat);
                    break;
                default:
                    this.logger.error(`Estado desconhecido: ${estagio}`);
                    this.gerenciadorEstado.limparEstadoUsuario(idUsuario);
                    break;
            }
        } catch (erro) {
            this.logger.error('Erro ao processar o estágio:', erro);
        }
    }

    async processarEstagioInicial(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'initial');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Oii amor, que bom que me chamou ❤️');
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Vou lhe enviar um áudio te explicando, momentinho vida');
        await delay(5000);
        await chat.sendStateRecording();
        await delay(config.delays.gravacao);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './audio1.aac', { sendAudioAsVoice: true });
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Você tem interesse amor? 😈🔥');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_preview');
    }

    async processarEstagioPreview(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_preview');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Vou te enviar minhas amostras');
        await delay(config.delays.entreVideos);
        const videos = ['./video1.mp4', './video2.mp4'];
        await this.gerenciadorMidia.enviarMultiplosVideos(this.client, msg, videos);
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Só estava faltando você lá atrás com sua rola gostosa🤤');
        await delay(5000);
        await chat.sendStateRecording();
        await delay(config.delays.gravacao);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './audio4.aac', { sendAudioAsVoice: true });
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_promise');
    }

    async processarEstagioPromise(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_promise');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Você é bem safadinho');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Me chamou na hora certa, estou sem sono e cheia de tesão 🔥');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Posso te mandar um áudio bem gostoso agora?😍');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_for_price_response');
    }

    async processarEstagioPriceResponse(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_for_price_response');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_final_promise');
        await this.processarProximoEstagio(idUsuario, msg, 'waiting_final_promise');
    }

    async processarEstagioFinalPromise(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_final_promise');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Seu safadinho, vou tirar minha calcinha, espere um pouco');
        await delay(20000);
        await chat.sendStateRecording();
        await delay(config.delays.gravacao);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './audio6.aac', { sendAudioAsVoice: true });
        await delay(5000);
        await chat.sendStateRecording();
        await delay(config.delays.gravacao);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './audio7.aac', { sendAudioAsVoice: true });
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Estou toda molhadinha, você quer ver?');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'sending_link');
    }

    async processarEstagioSendingLink(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'sending_link');
        await delay(5000);
        await chat.sendStateRecording();
        await delay(config.delays.gravacao);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './audio8.aac', { sendAudioAsVoice: true });
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Estou louca pra te ver gozar gostoso olhando minha bucetinha toda molhada🤤');
        await delay(5000);
        await chat.sendStateRecording();
        await delay(config.delays.gravacao);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './audio9.aac', { sendAudioAsVoice: true });
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Posso te mandar vida?😍');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_before_audio7');
    }

    async processarEstagioBeforeAudio7(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        await delay(5000);
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_before_audio7');
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Vou deixar por um valor bem baixo só para você meu bb');
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Mas só porque eu gostei muito de você viu..🥰');
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Promete que vai comprar amor?');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_before_audio6');
    }

    async processarEstagioBeforeAudio6(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_before_audio6');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Estou com apenas 2 vagas no meu grupinho, você tem sorte de ter falado comigo agora');
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Não me fale que vai me deixar gozar sozinha essa hora porque não vai ter menos de 19 reais, né amor?');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_before_audiofinal');
    }

    async processarRespostaUsuarioBeforeAudiofinal(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_before_audiofinal');

        // Registrar o tipo de mensagem recebida
        this.logger.info(`Usuário ${idUsuario} respondeu com tipo: ${msg.type}`);

        // Avançar para o próximo estado, independentemente do tipo de mensagem
        this.logger.info(`Usuário ${idUsuario} respondeu. Avançando para o estado waiting_after_audiofinal`);
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_after_audiofinal');
        await this.processarProximoEstagio(idUsuario, msg, 'waiting_after_audiofinal');
    }

    async processarEstagioAfterAudiofinal(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_after_audiofinal');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Vou te mandar minha tabelinha bb e você escolhe🥰 ');
        await delay(5000);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './foto.jpg', { sendMediaAsPhoto: true });
        await delay(5000);
        await chat.sendStateRecording();
        await delay(config.delays.gravacao);
        await this.gerenciadorMidia.enviarMidia(this.client, msg, './audio12.aac', { sendAudioAsVoice: true });
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'MINHA CHAVE PIX CELULAR: 👇🏼👇🏼 ');
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, '84991015553');
        await delay(config.delays.digitacao);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, '💦bit.ly/PagarPixx 👈🏼🥰');
        this.logger.info('Link enviado.');
        this.gerenciadorEstado.definirEstadoUsuario(idUsuario, 'waiting_after_audiofinal2');
    }

    async processarEstagioAfterAudiofinal2(idUsuario, msg, chat) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        this.gerenciadorEstado.marcarMensagemEnviada(idUsuario, 'waiting_after_audiofinal2');
        await delay(30000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Amor, eu só posso continuar nossa conversa se você comprar um dos meus pacotes');
        await delay(5000);
        await chat.sendStateTyping();
        await delay(config.delays.digitacao);
        await this.client.sendMessage(msg.from, 'Compre meu bb, estou te esperando lá🥰');
        this.gerenciadorEstado.finalizarConversa(idUsuario);
        this.gerenciadorEstado.limparEstadoUsuario(idUsuario);
        this.logger.info(`Conversa finalizada para o usuário ${idUsuario}`);
    }

    async tentarReconexao(motivo) {
        let tentativas = 0;
        const maxTentativas = config.limites.tentativasReconexao;
        while (tentativas < maxTentativas) {
            try {
                this.logger.info(`Tentativa de reconexão ${tentativas + 1}/${maxTentativas}`);
                await this.client.initialize();
                this.logger.info('Reconectado com sucesso');
                return;
            } catch (erro) {
                tentativas++;
                this.logger.error(`Falha na tentativa de reconexão ${tentativas}:`, erro);
                if (tentativas < maxTentativas) {
                    const tempoEspera = 5000 * tentativas;
                    await new Promise(resolve => setTimeout(resolve, tempoEspera));
                }
            }
        }
        this.logger.error('Máximo de tentativas de reconexão atingido. Reiniciando processo...');
        process.exit(1);
    }
}

// Inicialização
const bot = new WhatsAppBot();

import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
    getAuth,
    signInAnonymously
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {
    get,
    getDatabase,
    onDisconnect,
    onValue,
    ref,
    set,
    update
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js';

const valoresCartas = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'];
const parametrosUrl = new URLSearchParams(window.location.search);
const salaInformada = parametrosUrl.get('room') || 'equipe';
const salaId = /^[a-zA-Z0-9_-]{1,40}$/.test(salaInformada) ? salaInformada.toLowerCase() : 'equipe';
const caminhoSala = `rooms/${salaId}`;
const containerCartas = document.getElementById('container-cartas');
const formEntrada = document.getElementById('form-entrada');
const campoNome = document.getElementById('nome-participante');
const mensagemStatus = document.getElementById('mensagem-status');
const painelEntrada = document.getElementById('painel-entrada');
const painelJogo = document.getElementById('painel-jogo');
const botaoEntrar = document.getElementById('btn-entrar');
const listaParticipantes = document.getElementById('lista-participantes');
const resultadosVotos = document.getElementById('resultados-votos');
const botaoRevelar = document.getElementById('btn-revelar');
const botaoNovaRodada = document.getElementById('btn-limpar');
let database;
let participanteId;
let nomeParticipante = '';
let participantes = {};
let revelado = false;
let rodadaAtual = 1;
let votoSelecionado = null;
let ouvintesConectados = false;

document.getElementById('codigo-sala').textContent = salaId;
campoNome.value = sessionStorage.getItem(`planning-poker-name-${salaId}`) || '';

if (salaInformada !== salaId || !parametrosUrl.has('room')) {
    parametrosUrl.set('room', salaId);
    history.replaceState(null, '', `${window.location.pathname}?${parametrosUrl.toString()}`);
}

function configurarCartas() {
    valoresCartas.forEach(valor => {
        const carta = document.createElement('button');
        carta.type = 'button';
        carta.className = 'carta';
        carta.textContent = valor;
        carta.setAttribute('aria-label', `Votar ${valor}`);
        carta.disabled = true;
        carta.addEventListener('click', () => enviarVoto(valor));
        containerCartas.appendChild(carta);
    });
}

function atualizarStatus(mensagem, erro = false) {
    mensagemStatus.textContent = mensagem;
    mensagemStatus.classList.toggle('erro', erro);
}

function desenharParticipantes() {
    listaParticipantes.replaceChildren();
    const itens = Object.entries(participantes).sort(([, primeiro], [, segundo]) =>
        String(primeiro.name || '').localeCompare(String(segundo.name || ''), 'pt-BR')
    );

    itens.forEach(([id, participante]) => {
        const item = document.createElement('li');
        item.className = 'participante';
        const nome = document.createElement('span');
        nome.textContent = `${participante.name || 'Participante'}${id === participanteId ? ' (você)' : ''}`;
        const estado = document.createElement('span');
        const votou = participante.votedRound === rodadaAtual;
        estado.className = votou ? 'estado-voto votou' : 'estado-voto';
        estado.textContent = votou ? 'Votou' : 'Aguardando';
        item.append(nome, estado);
        listaParticipantes.appendChild(item);
    });

    document.getElementById('total-participantes').textContent = String(itens.length);
    document.getElementById('total-votos').textContent = String(
        itens.filter(([, participante]) => participante.votedRound === rodadaAtual).length
    );
}

function mostrarVotos(votos) {
    resultadosVotos.replaceChildren();
    const votosOrdenados = Object.entries(votos || {}).sort(([primeiro], [segundo]) => {
        const nomePrimeiro = participantes[primeiro]?.name || 'Participante';
        const nomeSegundo = participantes[segundo]?.name || 'Participante';
        return nomePrimeiro.localeCompare(nomeSegundo, 'pt-BR');
    });

    votosOrdenados.forEach(([id, valor]) => {
        const linha = document.createElement('div');
        linha.className = 'resultado-voto';
        const nome = document.createElement('span');
        nome.textContent = participantes[id]?.name || 'Participante';
        const voto = document.createElement('strong');
        voto.textContent = valor;
        linha.append(nome, voto);
        resultadosVotos.appendChild(linha);
    });

    resultadosVotos.hidden = false;
}

async function sincronizarResultados() {
    if (!revelado) {
        resultadosVotos.hidden = true;
        resultadosVotos.replaceChildren();
        return;
    }

    try {
        const snapshot = await get(ref(database, `${caminhoSala}/rounds/${rodadaAtual}/votes`));
        mostrarVotos(snapshot.val());
    } catch (erro) {
        atualizarStatus('Não foi possível carregar os votos revelados. Confira as regras do banco.', true);
        console.error(erro);
    }
}

function conectarSala() {
    if (ouvintesConectados) return;
    ouvintesConectados = true;

    onValue(ref(database, `${caminhoSala}/participants`), snapshot => {
        participantes = snapshot.val() || {};
        desenharParticipantes();
        if (revelado) sincronizarResultados();
    }, erro => {
        atualizarStatus('Sem acesso à sala. Confira as regras do Firebase Realtime Database.', true);
        console.error(erro);
    });

    onValue(ref(database, `${caminhoSala}/state`), snapshot => {
        const estado = snapshot.val() || {};
        const proximaRodada = Number(estado.round) || 1;
        if (proximaRodada !== rodadaAtual) {
            rodadaAtual = proximaRodada;
            votoSelecionado = null;
            document.getElementById('voto-atual').textContent = 'Nenhum';
            document.querySelectorAll('.carta').forEach(carta => {
                carta.classList.remove('selecionada');
                carta.setAttribute('aria-pressed', 'false');
            });
            registrarLimpezaAoDesconectar();
        }
        revelado = estado.revealed === true;
        botaoRevelar.disabled = revelado;
        botaoRevelar.textContent = revelado ? 'Votos revelados' : 'Revelar votos';
        document.querySelectorAll('.carta').forEach(carta => {
            carta.disabled = revelado;
        });
        atualizarStatus(revelado ? 'Votos revelados para todos na sala.' : 'Votos ocultos até a revelação.');
        sincronizarResultados();
    }, erro => {
        atualizarStatus('Não foi possível ler o estado da rodada. Confira as regras do Firebase.', true);
        console.error(erro);
    });
}

async function registrarLimpezaAoDesconectar() {
    if (!participanteId) return;
    try {
        await Promise.all([
            onDisconnect(ref(database, `${caminhoSala}/participants/${participanteId}`)).remove(),
            onDisconnect(ref(database, `${caminhoSala}/rounds/${rodadaAtual}/votes/${participanteId}`)).remove()
        ]);
    } catch (erro) {
        console.error('Não foi possível configurar a limpeza da presença.', erro);
    }
}

async function entrarNaSala(evento) {
    evento.preventDefault();
    nomeParticipante = campoNome.value.trim();
    if (!nomeParticipante || !participanteId) return;

    const participanteRef = ref(database, `${caminhoSala}/participants/${participanteId}`);
    try {
        await registrarLimpezaAoDesconectar();
        const atual = await get(participanteRef);
        await update(participanteRef, {
            name: nomeParticipante,
            votedRound: atual.val()?.votedRound ?? null
        });
        sessionStorage.setItem(`planning-poker-name-${salaId}`, nomeParticipante);
        painelEntrada.hidden = true;
        painelJogo.hidden = false;
        document.querySelectorAll('.carta').forEach(carta => {
            carta.disabled = false;
        });
        conectarSala();
        atualizarStatus('Você entrou na sala. Escolha uma carta para votar.');
    } catch (erro) {
        atualizarStatus('Não foi possível entrar. Confira a configuração e as regras do Firebase.', true);
        console.error(erro);
    }
}

async function enviarVoto(valor) {
    if (!participanteId || revelado) return;

    votoSelecionado = valor;
    document.getElementById('voto-atual').textContent = valor;
    document.querySelectorAll('.carta').forEach(carta => {
        carta.classList.toggle('selecionada', carta.textContent === valor);
        carta.setAttribute('aria-pressed', String(carta.textContent === valor));
    });

    try {
        await Promise.all([
            set(ref(database, `${caminhoSala}/rounds/${rodadaAtual}/votes/${participanteId}`), valor),
            update(ref(database, `${caminhoSala}/participants/${participanteId}`), { votedRound: rodadaAtual })
        ]);
        atualizarStatus('Voto registrado. Os valores ficam ocultos até a revelação.');
    } catch (erro) {
        atualizarStatus('Não foi possível registrar seu voto. Confira as regras do Firebase.', true);
        console.error(erro);
    }
}

async function revelarVotos() {
    if (!participanteId) return;
    try {
        await set(ref(database, `${caminhoSala}/state`), { revealed: true, round: String(rodadaAtual) });
    } catch (erro) {
        atualizarStatus('Não foi possível revelar os votos. Confira as regras do Firebase.', true);
        console.error(erro);
    }
}

async function iniciarNovaRodada() {
    if (!participanteId) return;
    try {
        await set(ref(database, `${caminhoSala}/state`), { revealed: false, round: String(rodadaAtual + 1) });
        votoSelecionado = null;
        document.getElementById('voto-atual').textContent = 'Nenhum';
        document.querySelectorAll('.carta').forEach(carta => {
            carta.classList.remove('selecionada');
            carta.setAttribute('aria-pressed', 'false');
        });
        atualizarStatus('Nova rodada iniciada.');
    } catch (erro) {
        atualizarStatus('Não foi possível iniciar a rodada. Confira as regras do Firebase.', true);
        console.error(erro);
    }
}

document.getElementById('btn-copiar-link').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(window.location.href);
        atualizarStatus('Link da sala copiado.');
    } catch (erro) {
        atualizarStatus('Não foi possível copiar o link neste navegador.', true);
    }
});

formEntrada.addEventListener('submit', entrarNaSala);
botaoRevelar.addEventListener('click', revelarVotos);
botaoNovaRodada.addEventListener('click', iniciarNovaRodada);
configurarCartas();

const configuracaoValida = Object.values(firebaseConfig).every(valor =>
    typeof valor === 'string' && valor.length > 0 && !valor.includes('COLOQUE_')
);

if (!configuracaoValida) {
    atualizarStatus('Configure as credenciais do Firebase em firebase-config.js para habilitar a sala.', true);
} else {
    try {
        const app = initializeApp(firebaseConfig);
        const autenticacao = getAuth(app);
        database = getDatabase(app);
        signInAnonymously(autenticacao).then(credencial => {
            participanteId = credencial.user.uid;
            botaoEntrar.disabled = false;
            atualizarStatus('Conexão pronta. Informe seu nome para entrar.');
        }).catch(erro => {
            atualizarStatus('Falha na autenticação anônima. Ative esse provedor no Firebase.', true);
            console.error(erro);
        });
    } catch (erro) {
        atualizarStatus('Configuração do Firebase inválida. Revise firebase-config.js.', true);
        console.error(erro);
    }
}
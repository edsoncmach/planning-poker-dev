const valoresCartas = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'];
const containerCartas = document.getElementById('container-cartas');
const textoVotoAtual = document.getElementById('voto-atual');
let votoSelecionado = null;

// Gera o deck de cartas
valoresCartas.forEach(valor => {
    const carta = document.createElement('div');
    carta.classList.add('carta');
    carta.innerText = valor;

    carta.addEventListener('click', () => {
        // Remove a seleção de todas as cartas
        document.querySelectorAll('.carta').forEach(c => c.classList.remove('selecionada'));

        // Adiciona seleção na carta clicada
        carta.classList.add('selecionada');
        votoSelecionado = valor;
        textoVotoAtual.innerText = votoSelecionado;

        // Futuro: Aqui entra o código para enviar o voto para o Firebase
    });

    containerCartas.appendChild(carta);
});

// Limpar mesa
document.getElementById('btn-limpar').addEventListener('click', () => {
    document.querySelectorAll('.carta').forEach(c => c.classList.remove('selecionada'));
    votoSelecionado = null;
    textoVotoAtual.innerText = 'Nenhum';
});
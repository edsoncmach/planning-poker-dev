# Polartis Poker da equipe

Aplicação estática para estimativa colaborativa. Cada pessoa pode entrar anonimamente informando um nome ou vincular o perfil Google para preencher nome e foto. O nome e a foto usados na sala são compartilhados com os demais participantes. A autenticação anônima do Firebase acontece automaticamente no navegador. O criador de uma sala é seu dono, controla a revelação e as novas rodadas. Os votos são sincronizados em tempo real; a estimativa exibida ajusta a média dos votos numéricos para a carta Fibonacci mais próxima e também mostra a média aritmética original. Em caso de empate entre duas cartas, a estimativa sobe para a próxima. As cartas `?` e `☕` ficam fora do cálculo.

## Configuração do Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/) e registre um aplicativo Web.
2. Em **Authentication > Sign-in method**, habilite **Anonymous** e **Google**. Em **Authentication > Settings > Authorized domains**, adicione o domínio do GitHub Pages, como `seu-usuario.github.io`.
3. Crie um **Realtime Database**. Copie a URL exibida na página do banco.
4. Substitua os valores de exemplo em `firebase-config.js` pelos dados do aplicativo Web. O `databaseURL` deve ser a URL exata do Realtime Database, que pode variar por região.
5. Em **Realtime Database > Rules**, publique estas regras atualizadas:

```json
{
	"rules": {
		"rooms": {
			"$roomId": {
				"meta": {
					".read": "auth != null",
					".write": "auth != null && ((!data.exists() && newData.child('owner').val() == auth.uid) || data.child('owner').val() == auth.uid)",
					".validate": "newData.hasChildren(['owner', 'name']) && newData.child('owner').isString() && newData.child('name').isString() && (!data.exists() || newData.child('owner').val() == data.child('owner').val())"
				},
				"participants": {
					".read": "auth != null",
					"$uid": {
						".write": "auth != null && auth.uid == $uid"
					}
				},
				"state": {
					".read": "auth != null",
					".write": "auth != null && root.child('rooms').child($roomId).child('meta').child('owner').val() == auth.uid"
				},
				"rounds": {
					"$round": {
						"votes": {
							".read": "auth != null && root.child('rooms').child($roomId).child('state').child('round').val() == $round && root.child('rooms').child($roomId).child('state').child('revealed').val() == true",
							"$uid": {
								".write": "auth != null && auth.uid == $uid"
							}
						}
					}
				}
			}
		}
	}
}
```

As regras permitem que cada participante altere apenas a própria presença e voto. O primeiro UID que cria os metadados fica registrado como dono; somente ele pode alterar o estado, revelar os votos ou iniciar outra rodada. Os votos da rodada atual só podem ser lidos depois de revelados. Salas antigas sem `meta` são reivindicadas pelo primeiro participante que entrar após atualizar as regras.

## Publicar no GitHub Pages

Envie os arquivos do projeto ao GitHub. No repositório, abra **Settings > Pages**, selecione a branch e a pasta que contém `index.html`, e salve. A aplicação usa módulos JavaScript e precisa ser aberta pelo endereço HTTPS do Pages ou por um servidor local, não diretamente como arquivo `file://`.

Abra a página sem `?room=` para criar uma sala com o nome da sprint ou funcionalidade. Depois de criada, informe seu nome e compartilhe o link gerado com o time. Quem abrir esse link entra na sala existente; o dono é a única pessoa que pode revelar votos e iniciar uma nova rodada.

Na entrada, a pessoa pode continuar anonimamente ou escolher **Usar perfil do Google**. O vínculo solicita autorização do Google e preenche nome e foto, que ficam visíveis aos participantes da sala e são removidos do Realtime Database quando a conexão termina. Em outro dispositivo ou navegador, uma conta Google já vinculada a um usuário Firebase não pode ser vinculada a uma nova sessão anônima; nesse caso, a entrada anônima continua disponível.

## Teste local

Depois de configurar o Firebase, inicie um servidor HTTP na pasta do projeto, por exemplo:

```sh
npx http-server .
```

Abra o endereço local informado pelo servidor em duas janelas para testar votação, revelação e nova rodada.

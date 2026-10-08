# Planning Poker da equipe

Aplicação estática para estimativa colaborativa. Cada pessoa entra com um nome, sem criar conta ou preencher uma tela de login. A autenticação anônima do Firebase acontece automaticamente no navegador. Os votos são sincronizados em tempo real e os valores ficam ocultos até alguém revelar a rodada.

## Configuração do Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/) e registre um aplicativo Web.
2. Em **Authentication > Sign-in method**, habilite **Anonymous**. Em **Authentication > Settings > Authorized domains**, adicione o domínio do GitHub Pages, como `seu-usuario.github.io`.
3. Crie um **Realtime Database**. Copie a URL exibida na página do banco.
4. Substitua os valores de exemplo em `firebase-config.js` pelos dados do aplicativo Web. O `databaseURL` deve ser a URL exata do Realtime Database, que pode variar por região.
5. Em **Realtime Database > Rules**, publique estas regras:

```json
{
	"rules": {
		"rooms": {
			"$roomId": {
				"participants": {
					".read": "auth != null",
					"$uid": {
						".write": "auth != null && auth.uid === $uid"
					}
				},
				"state": {
					".read": "auth != null",
					".write": "auth != null"
				},
				"rounds": {
					"$round": {
						"votes": {
							".read": "auth != null && root.child('rooms').child($roomId).child('state').child('round').val() === $round && root.child('rooms').child($roomId).child('state').child('revealed').val() === true",
							"$uid": {
								".write": "auth != null && auth.uid === $uid"
							}
						}
					}
				}
			}
		}
	}
}
```

As regras permitem que cada participante altere apenas o próprio nome e voto. Os votos da rodada atual só podem ser lidos depois de revelados. Qualquer pessoa que tenha o link da sala pode participar, revelar os votos e iniciar outra rodada; não há papel de moderador neste protótipo.

## Publicar no GitHub Pages

Envie os arquivos do projeto ao GitHub. No repositório, abra **Settings > Pages**, selecione a branch e a pasta que contém `index.html`, e salve. A aplicação usa módulos JavaScript e precisa ser aberta pelo endereço HTTPS do Pages ou por um servidor local, não diretamente como arquivo `file://`.

Compartilhe o endereço da página com `?room=equipe` no final. Outro nome cria outra sala, por exemplo `?room=sprint-42`. Use **Copiar link** na página para compartilhar a sala aberta.

## Teste local

Depois de configurar o Firebase, inicie um servidor HTTP na pasta do projeto, por exemplo:

```sh
npx http-server .
```

Abra o endereço local informado pelo servidor em duas janelas para testar votação, revelação e nova rodada.

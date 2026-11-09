# Fluxo de Clientes (advocacia)

Quadro de etapas para acompanhar processos e clientes de um escritório de advocacia. Foi feito primeiro para o celular.

- **Etapas editáveis:** Cliente novo → Acompanhamento → Pedir honorários → Concluso com juiz → Honorários fixados → Cobrança → Recebimento → Finalizado. Você pode renomear, reordenar, criar e excluir etapas.
- **✓ Concluir:** um toque leva o processo para a próxima etapa. O botão "Desfazer" e o botão de voltar desfazem o movimento.
- **Importação pela OAB:** consulta a API pública do Diário de Justiça Eletrônico Nacional (CNJ, `comunicaapi.pje.jus.br`) a cada 6 horas e na hora em que você pedir. Os processos novos caem em **Encontrados**, onde você **adiciona ao quadro** (escolhendo quem é o cliente entre as partes) ou **descarta**. O que você descartou ou removeu não volta sozinho e pode ser restaurado em *Mais › Descartados*.
- **Cadastro manual:** botão **+** (nome, telefone/WhatsApp, nº CNJ, vara, classe, honorários e anotações).
- Quando sai intimação nova num processo que já está no quadro, o cartão ganha o selo **"Nova intimação"**, com link para o tribunal.
- **Audiências:** quando a intimação traz a data ("para o dia 17/08/2026, às 13:00"), a audiência entra no processo sozinha. Quando o Projudi só avisa "AUDIÊNCIA DESIGNADA", o processo ganha o selo "falta a data", e você completa a data na aba **Agenda** ou no editar do processo. A agenda pode ser **assinada no Google Agenda ou no iPhone** (link `.ics` secreto), com avisos 1 dia antes e 2 horas antes.
- **Leitura por foto sem IA:** OCR (Tesseract) roda no próprio aparelho e regras fixas extraem nº CNJ, vara, classe, partes, parte assistida (= cliente), telefone e data de audiência. Funciona também com telas em duas colunas que quebram linha.
- No celular, as etapas aparecem como abas roláveis e a navegação fica na barra inferior. No computador, as etapas viram colunas e dá para arrastar e soltar os cartões. O app também pode ser instalado na tela inicial (PWA).

## Rodar

```bash
npm install
APP_USER=admin APP_PASSWORD=sua-senha SESSION_SECRET=um-segredo-longo npm start
```

| Variável | Padrão | Para quê |
|---|---|---|
| `APP_USER` / `APP_PASSWORD` | `admin` / *(vazio)* | Login. Sem senha, ninguém entra. |
| `SESSION_SECRET` | aleatório | Assina o cookie de sessão. Defina um valor fixo para que a sessão não caia a cada reinício. |
| `OAB_NUMERO` / `OAB_UF` | `65538` / `PR` | OAB consultada no DJEN. |
| `SYNC_HORAS` | `6` | Intervalo entre as buscas automáticas. |
| `DATA_DIR` | `./data` | Pasta do banco (`db.json`). No Docker, monte um volume em `/data`. |
| `PORT` | `3000` | Porta HTTP. |

## Docker / Easypanel

O app usa o `Dockerfile` da raiz. Monte um volume em `/data` e exponha a porta 3000.

Os dados dos clientes ficam **somente** no volume do servidor e nunca vão para este repositório.

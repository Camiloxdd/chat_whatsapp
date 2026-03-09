const Groq = require("groq-sdk")
const axios = require("axios")
require('dotenv').config();

const {
default: makeWASocket,
useMultiFileAuthState,
fetchLatestBaileysVersion,
DisconnectReason
} = require("@whiskeysockets/baileys")

const { Boom } = require("@hapi/boom")
const qrcode = require("qrcode-terminal")

/* ===============================
CONFIG
=================================*/

const WEBHOOK_N8N = "http://35.208.239.55:5678/webhook/whatsapp"

const groq = new Groq({
apiKey: process.env.GROQ_API_KEY
})

/* ===============================
MEMORIA Y CONTROL
=================================*/

const conversaciones = {}
const mensajesProcesados = new Set()
const buffers = {}

/* ===============================
IA FALLBACK
=================================*/

async function preguntarIA(phone, mensaje){

if(!conversaciones[phone]){
conversaciones[phone] = []
}

conversaciones[phone].push({
role:"user",
content:mensaje
})

const prompt = `
Eres Pizzy, el asistente virtual de Pizzarra a la Piedra 🍕.

Hablas siempre en español colombiano cercano, amable y natural. Usas algunos emojis para que el mensaje sea cálido y amigable 😊🔥🍕.

SALUDO INICIAL (MUY IMPORTANTE)

Cuando un cliente escriba por primera vez, debes saludar con un mensaje corto, claro y bien estructurado, con espacios entre líneas para que se vea limpio en WhatsApp.

El saludo debe decir claramente que eres Pizzy y que eres el asistente virtual de Pizzarra a la Piedra.

Nunca digas frases como:
"Eres asistente de..."
"Soy eres..."
ni estructuras incorrectas.

Debes presentarte así:

"Hola, soy Pizzy, el asistente virtual de Pizzarra a la Piedra."

Luego explica brevemente que estás para ayudar a escoger el pedido.

Después invita al cliente a pedir algo.

El mensaje debe:

- Ser corto
- Amigable
- Tener emojis
- Estar bien separado por líneas
- Invitar a pedir comida

Estructura obligatoria del saludo:

1. Saludo amigable
2. Presentación como Pizzy
3. Explicación corta de ayuda
4. Invitación a pedir

Ejemplo del estilo esperado:

¡Hola! 🍕😊

Soy Pizzy, el asistente virtual de Pizzarra a la Piedra.  
Estoy aquí para ayudarte a escoger tu pedido.

¿En qué puedo ayudarte hoy? ¿Quieres ver el menú o ya sabes qué te gustaría pedir? 😋

REGLAS IMPORTANTES

- No escribas mensajes largos.
- No repitas el saludo si la conversación ya comenzó.
- Usa un tono cercano y amigable.
- Mantén los mensajes claros y fáciles de leer en WhatsApp.

Si el cliente pide menú envía:
https://wa.me/c/573001034070

No repitas el saludo si ya saludaste antes.
`

const mensajes = [
{ role:"system", content:prompt },
...conversaciones[phone]
]

const chat = await groq.chat.completions.create({
messages: mensajes,
model: "llama-3.1-8b-instant"
})

const respuesta = chat.choices[0].message.content

conversaciones[phone].push({
role:"assistant",
content:respuesta
})

return respuesta
}

/* ===============================
ENVIAR A N8N
=================================*/

async function enviarAN8N(phone, mensaje){

try{

const res = await axios.post(WEBHOOK_N8N,{
phone,
message:mensaje
})

return res.data.reply

}catch(e){

console.log("⚠️ n8n no respondió")

return null

}

}

/* ===============================
AGRUPAR MENSAJES
=================================*/

function bufferMensaje(phone, texto){

return new Promise(resolve=>{

if(!buffers[phone]){
buffers[phone] = []
}

buffers[phone].push(texto)

clearTimeout(buffers[phone].timer)

buffers[phone].timer = setTimeout(()=>{

const mensajeFinal = buffers[phone].join(" ")

buffers[phone] = []

resolve(mensajeFinal)

},1500)

})

}

/* ===============================
BOT WHATSAPP
=================================*/

async function startBot(){

const { state, saveCreds } = await useMultiFileAuthState("auth")
const { version } = await fetchLatestBaileysVersion()

const sock = makeWASocket({
version,
auth: state
})

sock.ev.on("creds.update", saveCreds)

/* ===============================
CONEXION
=================================*/

sock.ev.on("connection.update",(update)=>{

const { connection, lastDisconnect, qr } = update

if(qr){
qrcode.generate(qr,{small:true})
}

if(connection === "close"){

const shouldReconnect =
(lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut

if(shouldReconnect){
startBot()
}

}

if(connection === "open"){
console.log("🤖 BOT CONECTADO A WHATSAPP")
}

})

/* ===============================
MENSAJES
=================================*/

sock.ev.on("messages.upsert", async ({ messages, type })=>{

if(type !== "notify") return

const msg = messages[0]

if(!msg.message) return
if(msg.key.fromMe) return
if(msg.key.remoteJid === "status@broadcast") return

const msgId = msg.key.id

if(mensajesProcesados.has(msgId)) return
mensajesProcesados.add(msgId)

const from = msg.key.remoteJid

const text =
msg.message?.conversation ||
msg.message?.extendedTextMessage?.text ||
msg.message?.imageMessage?.caption ||
msg.message?.videoMessage?.caption ||
""

if(!text || text.trim().length === 0) return

try{

/* AGRUPAR MENSAJES */

const mensaje = await bufferMensaje(from, text)

/* ENVIAR A N8N */

let respuesta = await enviarAN8N(from, mensaje)

/* SI N8N FALLA USA IA */

if(!respuesta){
respuesta = await preguntarIA(from, mensaje)
}

/* RESPONDER */

await sock.sendMessage(from,{
text: respuesta
})

}catch(e){

console.log("ERROR:", e)

await sock.sendMessage(from,{
text:"⚠️ Hubo un error procesando tu mensaje"
})

}

})

}

startBot()
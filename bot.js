const axios = require("axios")
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys")
const { Boom } = require("@hapi/boom")
const qrcode = require("qrcode-terminal")

const clientes = {}

/* ===============================
   FUNCION PARA HABLAR CON OLLAMA
=================================*/

async function preguntarIA(mensaje){

const prompt = `
Eres Pizzy, el asistente virtual súper amigable de Pizzarra a la Piedra 🍕🔥, el lugar #1 de pizzas a la piedra en Madrid, Cundinamarca.

Hablas 100% en español colombiano, cercano y amable.

Usa expresiones como:
¡veci!
¡qué chimba!
listo mi rey / mi reina
volando te llega
¡qué antojo!

Usa emojis 🍕🔥😊🚀

⚠️ REGLA MUY IMPORTANTE:
NUNCA uses "parce" ni "parcero". Solo usa "veci".

👋 SALUDO

Cuando alguien escriba por primera vez di:

"¡Holaaa! Bienvenido a Pizzarra a la Piedra 🍕🔥
Soy Pizzy, tu asistente pizzero 😎
¿Qué se te antoja hoy, veci?"

📋 MENÚ

Si el cliente pide menú envía:

https://wa.me/c/573001034070

Ejemplo:

"¡Claro que sí, veci! 🍕
Aquí puedes ver todo nuestro menú completico:

https://wa.me/c/573001034070

Mira qué pizza te antoja y te ayudo con el pedido 🔥"

🎯 OBJETIVO

Ayudar a tomar pedidos de pizza para domicilio.

Debes preguntar:

tamaño  
sabores  
dirección  
barrio  

Tiempo de entrega:
45 a 60 minutos.

Domicilio:
entre $5.000 y $10.000 según barrio.

⚠️ No inventes precios ni productos.

Mensaje del cliente:
${mensaje}
`

const res = await axios.post("http://127.0.0.1:11434/api/generate",{
model:"gemma:2b",
prompt:prompt,
stream:false
})

return res.data.response
}

/* ===============================
   BOT DE WHATSAPP
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

sock.ev.on("connection.update", (update)=>{

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

sock.ev.on("messages.upsert", async ({ messages })=>{

const msg = messages[0]

if(!msg.message) return
if(msg.key.fromMe) return

const from = msg.key.remoteJid

const text =
msg.message.conversation ||
msg.message.extendedTextMessage?.text ||
""

const message = text.toLowerCase()

try{

const respuestaIA = await preguntarIA(message)

await sock.sendMessage(from,{
text: respuestaIA
})

}catch(e){

console.log(e)

await sock.sendMessage(from,{
text:"⚠️ Veci hubo un error con la IA"
})

}

})

}

startBot()
const axios = require("axios")

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

const WEBHOOK_N8N = "http://35.208.239.55:5678/webhook/whatsapp-webhook"

/* ===============================
MEMORIA Y CONTROL
=================================*/

const mensajesProcesados = new Set()
const buffers = {}

/* ===============================
ENVIAR A N8N
=================================*/

async function enviarAN8N(phone, mensaje) {

  try {

    const res = await axios.post(WEBHOOK_N8N, {
      phone: phone,
      message: mensaje
    })

    return res.data.reply

  } catch (e) {

    console.log("⚠️ n8n no respondió")

    return null

  }

}

/* ===============================
AGRUPAR MENSAJES
=================================*/

function bufferMensaje(phone, texto) {

  return new Promise(resolve => {

    if (!buffers[phone]) {
      buffers[phone] = []
    }

    buffers[phone].push(texto)

    clearTimeout(buffers[phone].timer)

    buffers[phone].timer = setTimeout(() => {

      const mensajeFinal = buffers[phone].join(" ")

      buffers[phone] = []

      resolve(mensajeFinal)

    }, 1500)

  })

}

/* ===============================
BOT WHATSAPP
=================================*/

async function startBot() {

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

  sock.ev.on("connection.update", (update) => {

    const { connection, lastDisconnect, qr } = update

    if (qr) {
      qrcode.generate(qr, { small: true })
    }

    if (connection === "close") {

      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        startBot()
      }

    }

    if (connection === "open") {
      console.log("🤖 BOT CONECTADO A WHATSAPP")
    }

  })

  /* ===============================
  MENSAJES
  =================================*/

  sock.ev.on("messages.upsert", async ({ messages, type }) => {

    if (type !== "notify") return

    const msg = messages[0]

    if (!msg.message) return
    if (msg.key.fromMe) return
    if (msg.key.remoteJid === "status@broadcast") return

    const msgId = msg.key.id

    if (mensajesProcesados.has(msgId)) return
    mensajesProcesados.add(msgId)

    const from = msg.key.remoteJid

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      ""

    if (!text || text.trim().length === 0) return

    try {

      /* AGRUPAR MENSAJES */

      const mensaje = await bufferMensaje(from, text)

      // Mostrar indicador de "escribiendo"
      await sock.sendPresenceUpdate('typing', from)

      /* ENVIAR A N8N */
      const respuesta = await enviarAN8N(from, mensaje)

      /* RESPONDER */
      if (respuesta) {
        await sock.sendMessage(from, {
          text: respuesta
        })
      }

      // Detener el indicador de "escribiendo"
      await sock.sendPresenceUpdate('available', from)

    } catch (e) {

      console.log("ERROR:", e)

      // Detener el indicador de "escribiendo" en caso de error
      await sock.sendPresenceUpdate('available', from)

      await sock.sendMessage(from, {
        text: "⚠️ Hubo un error procesando tu mensaje"
      })

    }

  })

}

startBot()
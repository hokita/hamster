import { initFirebase } from './config/firebase'
import { createApp } from './app'

initFirebase()

const parsedPort = Number(process.env.PORT)
const port = Number.isNaN(parsedPort) ? 8080 : parsedPort
createApp().listen(port, () => {
  console.log(`Listening on port ${port}`)
})

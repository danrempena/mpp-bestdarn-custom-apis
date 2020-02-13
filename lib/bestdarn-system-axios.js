import axios from 'axios'

const bestdarnSystemAxios = axios.create({
  baseURL: process.env.BESTDARN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'Bearer ' + process.env.BESTDARN_ACCESS_TOKEN
  }
})

export default bestdarnSystemAxios

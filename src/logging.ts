import { configureLogging } from '@typist/core'
import { env } from 'cloudflare:workers'

configureLogging({
  environment: process.env.NODE_ENV === 'test' ? 'test' : env.ENV,
  runtime: 'server',
  level: process.env.LOG_LEVEL,
})

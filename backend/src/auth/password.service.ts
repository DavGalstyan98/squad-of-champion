import { Injectable, OnModuleInit } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash!: string

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'))
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    })
  }

  async verify(password: string, hash?: string): Promise<boolean> {
    try {
      // Unknown-email logins still perform password verification.
      return await argon2.verify(hash ?? this.dummyHash, password)
    } catch {
      return false
    }
  }
}

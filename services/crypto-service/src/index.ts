// Quantum-Safe Cryptography Service
// - ML-KEM (Kyber) for key encapsulation: 512/768/1024
// - ML-DSA (Dilithium) for signatures: 44/65/87
// - SLH-DSA (SPHINCS+) for hash-based signatures
// - AES-256-GCM hybrid wrap (for actual data encryption)
// - All NIST FIPS 203/204/205 standardized
import express from 'express';
import { ml_kem512, ml_kem768, ml_kem1024 } from '@noble/post-quantum/ml-kem';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa';
import { slh_dsa_sha2_128f, slh_dsa_sha2_192f, slh_dsa_sha2_256f } from '@noble/post-quantum/slh-dsa';
import { gcm } from '@noble/ciphers/aes';
import { sha3_256, sha3_512 } from '@noble/hashes/sha3';
import { randomBytes } from 'node:crypto';
import pino from 'pino';

const logger = pino({ name: 'crypto-service' });
const PORT = parseInt(process.env.PORT || '8096', 10);

const KEM = { ml_kem512, ml_kem768, ml_kem1024 } as const;
const DSA = { ml_dsa44, ml_dsa65, ml_dsa87 } as const;
const SLH = { slh_dsa_sha2_128f, slh_dsa_sha2_192f, slh_dsa_sha2_256f } as const;

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const ub64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

const app = express();
app.use(express.json({ limit: '4mb' }));
app.get('/health', (_q, r) => r.json({ status: 'ok', service: 'crypto-service',
  algorithms: { kem: Object.keys(KEM), dsa: Object.keys(DSA), slh: Object.keys(SLH) } }));

// ML-KEM (Kyber) keypair
app.post('/kem/keygen', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_kem768') as keyof typeof KEM;
  const k = KEM[algo]; if (!k) return res.status(400).json({ error: 'unknown algorithm' });
  const seed = randomBytes(64);
  const { publicKey, secretKey } = k.keygen(seed);
  res.json({ algo, publicKey: b64(publicKey), secretKey: b64(secretKey) });
});

// Encapsulate to publicKey -> ciphertext + shared secret
app.post('/kem/encapsulate', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_kem768') as keyof typeof KEM;
  const k = KEM[algo]; if (!k) return res.status(400).json({ error: 'unknown algorithm' });
  const pk = ub64(req.body?.publicKey ?? '');
  const { cipherText, sharedSecret } = k.encapsulate(pk);
  res.json({ algo, cipherText: b64(cipherText), sharedSecret: b64(sharedSecret) });
});

// Decapsulate ciphertext with secretKey -> shared secret
app.post('/kem/decapsulate', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_kem768') as keyof typeof KEM;
  const k = KEM[algo]; if (!k) return res.status(400).json({ error: 'unknown algorithm' });
  const sk = ub64(req.body?.secretKey ?? '');
  const ct = ub64(req.body?.cipherText ?? '');
  const sharedSecret = k.decapsulate(ct, sk);
  res.json({ algo, sharedSecret: b64(sharedSecret) });
});

// ML-DSA (Dilithium) signing
app.post('/dsa/keygen', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_dsa65') as keyof typeof DSA;
  const d = DSA[algo]; if (!d) return res.status(400).json({ error: 'unknown algorithm' });
  const seed = randomBytes(32);
  const { publicKey, secretKey } = d.keygen(seed);
  res.json({ algo, publicKey: b64(publicKey), secretKey: b64(secretKey) });
});

app.post('/dsa/sign', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_dsa65') as keyof typeof DSA;
  const d = DSA[algo]; if (!d) return res.status(400).json({ error: 'unknown algorithm' });
  const sk = ub64(req.body?.secretKey ?? '');
  const msg = ub64(req.body?.message ?? '');
  const sig = d.sign(sk, msg);
  res.json({ algo, signature: b64(sig) });
});

app.post('/dsa/verify', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_dsa65') as keyof typeof DSA;
  const d = DSA[algo]; if (!d) return res.status(400).json({ error: 'unknown algorithm' });
  const pk = ub64(req.body?.publicKey ?? '');
  const msg = ub64(req.body?.message ?? '');
  const sig = ub64(req.body?.signature ?? '');
  const valid = d.verify(pk, msg, sig);
  res.json({ algo, valid });
});

// SLH-DSA (SPHINCS+) hash-based signatures
app.post('/slh/keygen', (req, res) => {
  const algo = (req.body?.algo ?? 'slh_dsa_sha2_192f') as keyof typeof SLH;
  const s = SLH[algo]; if (!s) return res.status(400).json({ error: 'unknown algorithm' });
  const seed = randomBytes(48);
  const { publicKey, secretKey } = s.keygen(seed);
  res.json({ algo, publicKey: b64(publicKey), secretKey: b64(secretKey) });
});

app.post('/slh/sign', (req, res) => {
  const algo = (req.body?.algo ?? 'slh_dsa_sha2_192f') as keyof typeof SLH;
  const s = SLH[algo]; if (!s) return res.status(400).json({ error: 'unknown algorithm' });
  const sk = ub64(req.body?.secretKey ?? '');
  const msg = ub64(req.body?.message ?? '');
  const sig = s.sign(sk, msg);
  res.json({ algo, signature: b64(sig) });
});

app.post('/slh/verify', (req, res) => {
  const algo = (req.body?.algo ?? 'slh_dsa_sha2_192f') as keyof typeof SLH;
  const s = SLH[algo]; if (!s) return res.status(400).json({ error: 'unknown algorithm' });
  const pk = ub64(req.body?.publicKey ?? '');
  const msg = ub64(req.body?.message ?? '');
  const sig = ub64(req.body?.signature ?? '');
  const valid = s.verify(pk, msg, sig);
  res.json({ algo, valid });
});

// Hybrid encrypt: Kyber KEM -> AES-256-GCM (one-shot envelope)
app.post('/hybrid/encrypt', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_kem768') as keyof typeof KEM;
  const k = KEM[algo]; if (!k) return res.status(400).json({ error: 'unknown algorithm' });
  const pk = ub64(req.body?.publicKey ?? '');
  const plaintext = ub64(req.body?.plaintext ?? '');
  const aad = req.body?.aad ? ub64(req.body.aad) : new Uint8Array();
  const { cipherText: kemCt, sharedSecret } = k.encapsulate(pk);
  // Derive 256-bit AES key from shared secret using SHA3-256
  const aesKey = sha3_256(sharedSecret);
  const iv = randomBytes(12);
  const ct = gcm(aesKey, iv, aad).encrypt(plaintext);
  res.json({ algo, kemCipherText: b64(kemCt), iv: b64(iv), ciphertext: b64(ct), aad: b64(aad) });
});

app.post('/hybrid/decrypt', (req, res) => {
  const algo = (req.body?.algo ?? 'ml_kem768') as keyof typeof KEM;
  const k = KEM[algo]; if (!k) return res.status(400).json({ error: 'unknown algorithm' });
  const sk = ub64(req.body?.secretKey ?? '');
  const kemCt = ub64(req.body?.kemCipherText ?? '');
  const iv = ub64(req.body?.iv ?? '');
  const ct = ub64(req.body?.ciphertext ?? '');
  const aad = req.body?.aad ? ub64(req.body.aad) : new Uint8Array();
  const sharedSecret = k.decapsulate(kemCt, sk);
  const aesKey = sha3_256(sharedSecret);
  const pt = gcm(aesKey, iv, aad).decrypt(ct);
  res.json({ algo, plaintext: b64(pt) });
});

// Utility hash endpoint
app.post('/hash', (req, res) => {
  const data = ub64(req.body?.data ?? '');
  const algo = (req.body?.algo ?? 'sha3-256') as 'sha3-256'|'sha3-512';
  const hash = algo === 'sha3-512' ? sha3_512(data) : sha3_256(data);
  res.json({ algo, hash: b64(hash) });
});

app.listen(PORT, () => logger.info({ port: PORT }, 'crypto-service listening (NIST PQ FIPS 203/204/205)'));

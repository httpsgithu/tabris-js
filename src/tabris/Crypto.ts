import NativeObject from './NativeObject';
import {toValueString} from './Console';
import CryptoKey, {Algorithm, AlgorithmECDH, AlgorithmHKDF, AlgorithmInternal, _CryptoKey} from './CryptoKey';
import {allowOnlyKeys, allowOnlyValues, getBuffer, getCid, getNativeObject} from './util';
import checkType from './checkType';

export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray
  | Int16Array | Uint16Array | Int32Array | Uint32Array;

export default class Crypto {

  readonly subtle!: SubtleCrypto;
  private readonly _nativeObject!: NativeCrypto;

  constructor() {
    Object.defineProperties(this, {
      _nativeObject: {enumerable: false, writable: false, value: NativeCrypto.getInstance()},
      subtle: {enumerable: false, writable: false, value: new SubtleCrypto()}
    });
  }

  getRandomValues(typedArray: TypedArray) {
    if (arguments.length === 0) {
      throw new Error('Not enough arguments to Crypto.getRandomValues');
    }
    if (
      !ArrayBuffer.isView(typedArray)
      || typedArray instanceof Float32Array
      || typedArray instanceof Float64Array
    ) {
      throw new Error(`Argument ${toValueString(typedArray)} is not an accepted array type`);
    }
    return this._nativeObject.getRandomValues(typedArray);
  }

}

const validAlgorithms = new Set(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);

class SubtleCrypto {

  private readonly _nativeObject!: NativeCrypto;

  constructor() {
    Object.defineProperty(this, '_nativeObject', {
      enumerable: false, writable: false, value: NativeCrypto.getInstance()
    });
  }

  async digest(algorithm: string, data: ArrayBuffer | TypedArray) {
    if (arguments.length < 2) {
      return Promise.reject(new TypeError('Not enough arguments to SubtleCrypto.digest'));
    }
    if (!validAlgorithms.has(algorithm)) {
      return Promise.reject(new TypeError(`Algorithm: Unrecognized name ${algorithm}`));
    }
    if (!getBuffer(data)) {
      return Promise.reject(new TypeError(`Argument ${toValueString(data)} is not an accepted array type`));
    }
    return new Promise(
      (resolve, reject) => this._nativeObject.subtleDigest({algorithm, data, resolve, reject})
    );
  }

  async importKey(
    format: string,
    keyData: ArrayBuffer | TypedArray,
    algorithm: Algorithm,
    extractable: boolean,
    keyUsages: string[]
  ): Promise<CryptoKey> {
    if (arguments.length !== 5) {
      throw new TypeError(`Expected 5 arguments, got ${arguments.length}`);
    }
    allowOnlyValues(format, ['spki', 'pkcs8', 'raw'], 'format');
    checkType(getBuffer(keyData), ArrayBuffer, {name: 'keyData'});
    if (typeof algorithm === 'string') {
      allowOnlyValues(algorithm, ['ECDH', 'AES-GCM', 'HKDF'], 'algorithm');
    } else {
      checkType(algorithm, Object, {name: 'algorithm'});
      allowOnlyValues(algorithm.name, ['ECDH', 'AES-GCM'], 'algorithm.name');
      if (algorithm.name === 'ECDH') {
        allowOnlyKeys(algorithm, ['name', 'namedCurve']);
        allowOnlyValues(algorithm.namedCurve, ['P-256'], 'algorithm.namedCurve');
      } else {
        allowOnlyKeys(algorithm, ['name']);
      }
    }
    checkType(extractable, Boolean, {name: 'extractable'});
    checkType(keyUsages, Array, {name: 'keyUsages'});
    const nativeObject = new _CryptoKey();
    const algorithmKeys = Object.keys(algorithm);
    const algorithmInternal = algorithmKeys.length === 1 && algorithmKeys[0] === 'name'
      ? (algorithm as {name: string}).name as AlgorithmInternal : algorithm as AlgorithmInternal;
    await nativeObject.import(format, keyData, algorithmInternal, extractable, keyUsages);
    return new CryptoKey(nativeObject, {
      algorithm: algorithmInternal,
      extractable,
      usages: Object.freeze(keyUsages.concat())
    });
  }

  async deriveBits(
    algorithm: Algorithm,
    baseKey: CryptoKey,
    length: number
  ): Promise<ArrayBuffer> {
    if (arguments.length !== 3) {
      throw new TypeError(`Expected 3 arguments, got ${arguments.length}`);
    }
    checkDeriveAlgorithm(algorithm);
    checkType(baseKey, CryptoKey, {name: 'baseKey'});
    checkType(length, Number, {name: 'length'});
    const nativeObject = new _CryptoKey();
    try {
      await nativeObject.derive(algorithm, baseKey, {length, name: 'AES-GCM'}, true, []);
      return new Promise((onSuccess, onReject) =>
        this._nativeObject.subtleExportKey('raw', nativeObject, onSuccess, onReject)
      );
    } finally {
      nativeObject.dispose();
    }
  }

  async deriveKey(
    algorithm: Algorithm,
    baseKey: CryptoKey,
    derivedKeyAlgorithm: {name: string, length: number},
    extractable: boolean,
    keyUsages: string[]
  ): Promise<CryptoKey> {
    if (arguments.length !== 5) {
      throw new TypeError(`Expected 5 arguments, got ${arguments.length}`);
    }
    checkDeriveAlgorithm(algorithm);
    allowOnlyKeys(derivedKeyAlgorithm, ['name', 'length']);
    allowOnlyValues(derivedKeyAlgorithm.name, ['AES-GCM'], 'derivedKeyAlgorithm.name');
    checkType(derivedKeyAlgorithm.length, Number, {name: 'derivedKeyAlgorithm.length'});
    checkType(baseKey, CryptoKey, {name: 'baseKey'});
    checkType(extractable, Boolean, {name: 'extractable'});
    checkType(keyUsages, Array, {name: 'keyUsages'});
    const nativeObject = new _CryptoKey();
    await nativeObject.derive(algorithm, baseKey, derivedKeyAlgorithm, extractable, keyUsages);
    return new CryptoKey(nativeObject, {
      algorithm,
      extractable,
      type: 'secret',
      usages: Object.freeze(keyUsages.concat())
    });
  }

  async decrypt(
    algorithm: {
      name: string,
      iv: ArrayBuffer | TypedArray,
      tagLength?: number
    },
    key: CryptoKey,
    data: ArrayBuffer | TypedArray
  ): Promise<ArrayBuffer> {
    if (arguments.length !== 3) {
      throw new TypeError(`Expected 3 arguments, got ${arguments.length}`);
    }
    allowOnlyKeys(algorithm, ['name', 'iv', 'tagLength']);
    allowOnlyValues(algorithm.name, ['AES-GCM'], 'algorithm.name');
    checkType(algorithm.tagLength, Number, {name: 'algorithm.tagLength', nullable: true});
    checkType(getBuffer(algorithm.iv), ArrayBuffer, {name: 'algorithm.iv'});
    checkType(key, CryptoKey, {name: 'key'});
    checkType(getBuffer(data), ArrayBuffer, {name: 'data'});
    return new Promise((onSuccess, onReject) =>
      this._nativeObject.subtleDecrypt(algorithm, key, data, onSuccess, onReject)
    );
  }

  async encrypt(
    algorithm: {
      name: string,
      iv: ArrayBuffer | TypedArray,
      tagLength?: number
    },
    key: CryptoKey,
    data: ArrayBuffer | TypedArray
  ): Promise<ArrayBuffer> {
    if (arguments.length !== 3) {
      throw new TypeError(`Expected 3 arguments, got ${arguments.length}`);
    }
    allowOnlyKeys(algorithm, ['name', 'iv', 'tagLength']);
    allowOnlyValues(algorithm.name, ['AES-GCM'], 'algorithm.name');
    checkType(algorithm.tagLength, Number, {name: 'algorithm.tagLength', nullable: true});
    checkType(getBuffer(algorithm.iv), ArrayBuffer, {name: 'algorithm.iv'});
    checkType(key, CryptoKey, {name: 'key'});
    checkType(getBuffer(data), ArrayBuffer, {name: 'data'});
    return new Promise((onSuccess, onReject) =>
      this._nativeObject.subtleEncrypt(algorithm, key, data, onSuccess, onReject)
    );
  }

  async exportKey(
    format: 'raw' | 'spki',
    key: CryptoKey
  ): Promise<ArrayBuffer> {
    if (arguments.length !== 2) {
      throw new TypeError(`Expected 2 arguments, got ${arguments.length}`);
    }
    allowOnlyValues(format, ['raw', 'spki'], 'format');
    checkType(key, CryptoKey, {name: 'key'});
    return new Promise((onSuccess, onReject) =>
      this._nativeObject.subtleExportKey(format, key, onSuccess, onReject)
    );
  }

  async generateKey(
    algorithm: AlgorithmECDH,
    extractable: boolean,
    keyUsages: string[]
  ): Promise<{privateKey: CryptoKey, publicKey: CryptoKey}> {
    if (arguments.length !== 3) {
      throw new TypeError(`Expected 3 arguments, got ${arguments.length}`);
    }
    allowOnlyKeys(algorithm, ['name', 'namedCurve']);
    allowOnlyValues(algorithm.name, ['ECDH'], 'algorithm.name');
    allowOnlyValues(algorithm.namedCurve, ['P-256'], 'algorithm.namedCurve');
    checkType(extractable, Boolean, {name: 'extractable'});
    checkType(keyUsages, Array, {name: 'keyUsages'});
    const nativeObject = new _CryptoKey();
    await nativeObject.generate(algorithm, extractable, keyUsages);
    const nativePrivate = new _CryptoKey(nativeObject, 'private');
    const nativePublic = new _CryptoKey(nativeObject, 'public');
    return {
      privateKey: new CryptoKey(nativePrivate, {algorithm, extractable}),
      publicKey: new CryptoKey(nativePublic, {algorithm, extractable})
    };
  }

}

class NativeCrypto extends NativeObject {

  private static instance: NativeCrypto;

  static getInstance() {
    if (!this.instance) {
      this.instance = new NativeCrypto();
    }
    return this.instance;
  }

  get _nativeType() {
    return 'tabris.Crypto';
  }

  getRandomValues(typedArray: ArrayBufferView) {
    const byteLength = typedArray.byteLength;
    const values = new Uint8Array(
      this._nativeCall('getRandomValues', {byteLength}) as ArrayBuffer
    );
    if (values.byteLength !== byteLength) {
      throw new Error('Not enough random bytes available');
    }
    new Uint8Array(typedArray.buffer).set(values);
    return typedArray;
  }

  subtleDigest(arg: {
    algorithm: string,
    data: ArrayBuffer | TypedArray,
    resolve: (buffer: ArrayBuffer) => any,
    reject: (ex: Error) => any
  }) {
    this._nativeCall('subtleDigest', {
      algorithm: arg.algorithm,
      data: ArrayBuffer.isView(arg.data) ? arg.data.buffer : arg.data,
      onSuccess: (result: ArrayBuffer) => {
        if (!(result instanceof ArrayBuffer) || result.byteLength === 0) {
          throw new TypeError('Internal Type Error: result is not valid ArrayBuffer');
        }
        arg.resolve(result);
      },
      onError: (reason: unknown) => arg.reject(new Error(String(reason)))
    });
  }

  subtleDecrypt(
    algorithm: {
      name: string,
      iv: ArrayBuffer | TypedArray,
      tagLength?: number
    },
    key: CryptoKey,
    data: ArrayBuffer | TypedArray,
    onSuccess: (buffer: ArrayBuffer) => any,
    onError: (ex: Error) => any
  ): void {
    const {name, iv, tagLength} = algorithm;
    this._nativeCall('subtleDecrypt', {
      algorithm: {
        name,
        iv: getBuffer(iv),
        tagLength: isNaN(tagLength as number) ? 128 : tagLength
      },
      key: getNativeObject(key).cid,
      data: ArrayBuffer.isView(data) ? data.buffer : data,
      onSuccess,
      onError: (reason: unknown) => onError(new Error(String(reason)))
    });
  }

  subtleExportKey(
    format: string,
    key: CryptoKey | _CryptoKey,
    onSuccess: (value: ArrayBuffer) => void,
    onError: (ex: any) => void
  ): void {
    this._nativeCall('subtleExportKey', {
      format,
      key: getCid(key),
      onSuccess,
      onError: (reason: unknown) => onError(new Error(String(reason)))
    });
  }

  subtleEncrypt(
    algorithm: {
      name: string,
      iv: ArrayBuffer | TypedArray,
      tagLength?: number
    },
    key: CryptoKey,
    data: ArrayBuffer | TypedArray,
    onSuccess: (value: ArrayBuffer) => void,
    onError: (ex: any) => void
  ): void {
    const {name, iv, tagLength} = algorithm;
    this._nativeCall('subtleEncrypt', {
      algorithm: {
        name,
        iv: getBuffer(iv),
        tagLength: isNaN(tagLength as number) ? 128 : tagLength
      },
      key: getCid(key),
      data: getBuffer(data),
      onSuccess,
      onError: (reason: unknown) => onError(new Error(String(reason)))
    });
  }

}

function checkDeriveAlgorithm(algorithm: Algorithm):
  asserts algorithm is (AlgorithmHKDF | AlgorithmECDH | 'HKDF')
{
  if (algorithm === 'HKDF') {
    return;
  }
  if (algorithm === 'AES-GCM') {
    throw new TypeError('AES-GCM not supported for this function');
  }
  allowOnlyKeys(algorithm, ['name', 'namedCurve', 'public', 'hash', 'salt', 'info']);
  allowOnlyValues(algorithm.name, ['ECDH', 'HKDF'], 'algorithm.name');
  if (algorithm.name === 'ECDH') {
    allowOnlyValues(algorithm.namedCurve, ['P-256'], 'algorithm.namedCurve');
    checkType(algorithm.public, CryptoKey, {name: 'algorithm.public'});
  } else if (algorithm.name === 'HKDF') {
    checkType(algorithm.hash, String, {name: 'algorithm.hash'});
    checkType(getBuffer(algorithm.salt), ArrayBuffer, {name: 'algorithm.salt'});
    checkType(getBuffer(algorithm.info), ArrayBuffer, {name: 'algorithm.info'});
  }
}

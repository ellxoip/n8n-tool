"""Local STT on CUDA or CPU and CPU TTS. Audio is never retained."""
import io
import json
import os
import threading
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response, FileResponse
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from piper.voice import PiperVoice

VOICE_PATH = Path(os.environ['PIPER_MODEL_PATH'])
STT_PATH = os.environ['WHISPER_MODEL_PATH']
STT_DEVICE = os.environ.get('WHISPER_DEVICE', 'cpu')
STT_PRECISION = os.environ.get('WHISPER_COMPUTE_TYPE', 'int8' if STT_DEVICE == 'cpu' else 'int8_float16')
STT_CPU_THREADS = max(1, int(os.environ.get('WHISPER_CPU_THREADS', '4')))
STT_BEAM_SIZE = max(1, int(os.environ.get('WHISPER_BEAM_SIZE', '1')))
lock = threading.Lock()
voice = None
whisper = None


@asynccontextmanager
async def lifespan(app):
    global voice, whisper
    voice = PiperVoice.load(VOICE_PATH, use_cuda=False)
    whisper = WhisperModel(STT_PATH, device=STT_DEVICE, compute_type=STT_PRECISION, cpu_threads=STT_CPU_THREADS, num_workers=1, local_files_only=True)
    # Allocate decoder/workspace at startup rather than on the first utterance.
    segments, _ = whisper.transcribe(np.zeros(16000, dtype=np.float32), language='es', beam_size=1, best_of=1, max_new_tokens=4, without_timestamps=True, condition_on_previous_text=False)
    list(segments)
    yield


app = FastAPI(lifespan=lifespan)


@app.get('/health')
def health():
    return {'ok': voice is not None and whisper is not None, 'tts': 'piper-cpu', 'stt': 'whisper-small-' + STT_PRECISION, 'device': STT_DEVICE}


@app.get('/page', response_class=HTMLResponse)
def page():
    return HTMLResponse(Path(__file__).with_name('phone.html').read_text(encoding='utf8'), headers={'Cache-Control': 'no-store'})


@app.get('/assets/{filename}')
def asset(filename: str):
    if filename not in {'conversation.mjs', 'vad-core.mjs', 'voice-worklet.js'}:
        raise HTTPException(404, 'Archivo no encontrado.')
    return FileResponse(Path(__file__).with_name(filename), media_type='text/javascript', headers={'Cache-Control': 'no-store'})


@app.post('/v1/audio/transcriptions')
def transcribe(file: UploadFile = File(...), model: str = Form('small')):
    if not lock.acquire(blocking=False):
        file.file.close()
        raise HTTPException(429, 'El servidor de voz esta ocupado. Intenta nuevamente en unos segundos.')
    started = time.monotonic()
    try:
        data = file.file.read(8 * 1024 * 1024 + 1)
        if not data or len(data) > 8 * 1024 * 1024:
            raise HTTPException(413, 'Audio vacio o superior a 8 MB.')
        try:
            audio = decode_audio(io.BytesIO(data), sampling_rate=16000)
        except Exception:
            raise HTTPException(400, 'No se pudo leer el audio. Envia WAV, MP3, M4A u OGG/WebM.')
        if len(audio) / 16000 > 60:
            raise HTTPException(413, 'Graba mensajes de hasta 60 segundos.')
        if not len(audio) or np.max(np.abs(audio)) < 0.001:
            raise HTTPException(422, 'No se detecto voz en el audio.')
        segments, info = whisper.transcribe(audio, language='es', beam_size=STT_BEAM_SIZE, best_of=1, condition_on_previous_text=False, vad_filter=True, without_timestamps=True)
        text = ' '.join(segment.text.strip() for segment in segments).strip()
        if not text:
            raise HTTPException(422, 'No se detecto voz. Acerca el microfono y vuelve a grabar.')
        return Response(json.dumps({'text': text, 'language': info.language, 'seconds': round(time.monotonic() - started, 2)}), media_type='application/json', headers={'Cache-Control': 'no-store'})
    finally:
        file.file.close()
        lock.release()


@app.post('/v1/audio/speech')
def speech(body: dict):
    text = str(body.get('input', '')).strip()
    if not text or len(text) > 4000:
        raise HTTPException(400, 'El texto debe contener entre 1 y 4000 caracteres.')
    if body.get('response_format', 'wav') != 'wav':
        raise HTTPException(400, 'Este servidor entrega WAV. Configura TTS_FORMAT=wav.')
    if not lock.acquire(blocking=False):
        raise HTTPException(429, 'El servidor de voz esta ocupado.')
    started = time.monotonic()
    try:
        result = io.BytesIO()
        with wave.open(result, 'wb') as wav:
            voice.synthesize_wav(text, wav)
        return Response(result.getvalue(), media_type='audio/wav', headers={'X-TTS-Seconds': str(round(time.monotonic() - started, 2)), 'Cache-Control': 'no-store'})
    finally:
        lock.release()

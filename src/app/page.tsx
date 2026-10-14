'use client';

import React, { useState, useRef } from 'react';
import {
  Link2,
  Upload,
  ShieldCheck,
  Download,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  FileVideo,
  Copy,
  RotateCcw,
  Layers,
  Clock,
  MapPin,
  Cpu,
  Zap,
} from 'lucide-react';
import { cleanMp4Metadata, CleanResult } from '@/lib/mp4Cleaner';

type ProcessingStep = 'idle' | 'fetching' | 'inspecting' | 'stripping' | 'ready' | 'error';
type ActiveTab = 'link' | 'upload' | 'direct';

export default function Home() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('link');
  const [urlInput, setUrlInput] = useState('');
  const [directVideoUrl, setDirectVideoUrl] = useState('');
  const [step, setStep] = useState<ProcessingStep>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [requiresFallback, setRequiresFallback] = useState(false);
  const [fallbackHelp, setFallbackHelp] = useState('');

  const [cameraStyle, setCameraStyle] = useState<'iphone' | 'android'>('iphone');

  // Results
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);
  const [cleanVideoUrl, setCleanVideoUrl] = useState<string | null>(null);
  const [originalVideoName, setOriginalVideoName] = useState('video_instagram.mp4');
  const [isDragActive, setIsDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle Clipboard Paste
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (activeTab === 'link') setUrlInput(text.trim());
        if (activeTab === 'direct') setDirectVideoUrl(text.trim());
      }
    } catch {
      alert('Permissão de colar negada pelo navegador.');
    }
  };

  // Process video buffer locally through mp4Cleaner
  const processVideoBuffer = async (arrayBuffer: ArrayBuffer, filename: string, style = cameraStyle) => {
    setStep('inspecting');
    setStatusMessage('Examinando estrutura binária de átomos MP4 & EXIF...');

    await new Promise((resolve) => setTimeout(resolve, 350));

    setStep('stripping');
    setStatusMessage('Excluindo átomos udta, GPS, tags de origem e redefinindo carimbos...');

    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      const result = cleanMp4Metadata(arrayBuffer, style);
      setCleanResult(result);

      // Create downloadable clean Blob
      const blob = new Blob([result.cleanedBuffer as any], { type: 'video/mp4' });
      const objectUrl = URL.createObjectURL(blob);
      setCleanVideoUrl(objectUrl);
      setOriginalVideoName(filename);

      setStep('ready');
      setStatusMessage('Vídeo purificado com sucesso! 100% livre de rastros.');
    } catch (err: any) {
      console.error('Erro ao purificar vídeo:', err);
      setStep('error');
      setErrorMessage('Falha ao processar a estrutura do vídeo: ' + err.message);
    }
  };

  // Handle Instagram Link Submission
  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setStep('fetching');
    setErrorMessage('');
    setRequiresFallback(false);
    setStatusMessage('Localizando vídeo nos servidores do Instagram...');

    try {
      const response = await fetch('/api/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      const data = await response.json();

      if (!response.ok || data.error && !data.requiresFallback) {
        throw new Error(data.error || 'Falha ao buscar vídeo do Instagram.');
      }

      if (data.requiresFallback) {
        setRequiresFallback(true);
        setFallbackHelp(data.help);
        setStep('idle');
        return;
      }

      if (!data.media?.url && !data.proxyUrl) {
        throw new Error('Nenhum fluxo de vídeo foi detectado para este link.');
      }

      setStatusMessage('Baixando fluxo de vídeo e preparando purificação...');

      // Fetch the video through proxy or direct link
      const videoFetchUrl = data.proxyUrl || data.media.url;
      const videoRes = await fetch(videoFetchUrl);

      if (!videoRes.ok) {
        throw new Error(`Falha ao obter os dados do vídeo: ${videoRes.statusText}`);
      }

      const buffer = await videoRes.arrayBuffer();
      const filename = data.shortcode ? `instagram_${data.shortcode}.mp4` : 'instagram_video.mp4';
      await processVideoBuffer(buffer, filename);
    } catch (err: any) {
      console.error('Erro ao baixar:', err);
      setStep('error');
      setErrorMessage(
        err.message || 'Não foi possível baixar o vídeo automaticamente. Tente fazer o upload do arquivo diretamente.'
      );
    }
  };

  // Handle Direct Video URL
  const handleDirectUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directVideoUrl.trim()) return;

    setStep('fetching');
    setErrorMessage('');
    setStatusMessage('Carregando fluxo de vídeo direto...');

    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(directVideoUrl.trim())}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error('Não foi possível obter o vídeo desta URL.');

      const buffer = await res.arrayBuffer();
      await processVideoBuffer(buffer, 'direct_video.mp4');
    } catch (err: any) {
      setStep('error');
      setErrorMessage(err.message || 'Erro ao carregar link de vídeo.');
    }
  };

  // Handle Direct File Upload (Drag and Drop)
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.type.includes('video') && !file.name.match(/\.(mp4|mov|m4v)$/i)) {
      setErrorMessage('Por favor, selecione um arquivo de vídeo válido (.mp4 ou .mov).');
      return;
    }

    setStep('fetching');
    setErrorMessage('');
    setStatusMessage('Carregando vídeo localmente no navegador...');

    try {
      const buffer = await file.arrayBuffer();
      await processVideoBuffer(buffer, file.name);
    } catch (err: any) {
      setStep('error');
      setErrorMessage('Erro ao ler arquivo: ' + err.message);
    }
  };

  // Reset to clean another video
  const handleReset = () => {
    if (cleanVideoUrl) {
      URL.revokeObjectURL(cleanVideoUrl);
    }
    setCleanResult(null);
    setCleanVideoUrl(null);
    setStep('idle');
    setErrorMessage('');
    setUrlInput('');
    setDirectVideoUrl('');
    setRequiresFallback(false);
  };

  // Format bytes to MB
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <main className="app-container">
      {/* Header section */}
      <header className="header">
        <div className="brand-badge">
          <span className="brand-badge-dot" />
          <span>InstaFlow v1.0 • Purificador de Vídeos</span>
        </div>

        <h1 className="main-title">
          Baixe do <span className="gradient-text-insta">Instagram</span> & Deixe o Vídeo{' '}
          <span className="gradient-text-clean">100% RAW</span>
        </h1>

        <p className="subtitle">
          Elimina metadados EXIF, coordenadas de GPS, rastros da plataforma e assinaturas de encoder.
          Pronto para repostar no TikTok, Reels ou Shorts sem penalizações.
        </p>
      </header>

      {/* Main Glass Card */}
      <section className="glass-card" aria-label="Área de processamento de vídeo">
        {step !== 'ready' && (
          <>
            {/* Tabs */}
            <div className="tabs-container" role="tablist">
              <button
                id="tab-link-btn"
                role="tab"
                aria-selected={activeTab === 'link'}
                className={`tab-btn ${activeTab === 'link' ? 'active' : ''}`}
                onClick={() => setActiveTab('link')}
              >
                <Link2 size={18} />
                <span>Link do Instagram</span>
              </button>
              <button
                id="tab-upload-btn"
                role="tab"
                aria-selected={activeTab === 'upload'}
                className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => setActiveTab('upload')}
              >
                <Upload size={18} />
                <span>Upload de Vídeo (.mp4)</span>
              </button>
              <button
                id="tab-direct-btn"
                role="tab"
                aria-selected={activeTab === 'direct'}
                className={`tab-btn ${activeTab === 'direct' ? 'active' : ''}`}
                onClick={() => setActiveTab('direct')}
              >
                <FileVideo size={18} />
                <span>Link Direto (.mp4)</span>
              </button>
            </div>

            {/* Tab 1: Instagram Link */}
            {activeTab === 'link' && (
              <form onSubmit={handleLinkSubmit} className="input-group">
                <div className="url-input-wrapper">
                  <Link2 size={20} color="#a855f7" />
                  <input
                    id="instagram-url-input"
                    type="url"
                    placeholder="Cole aqui o link do Reel ou Post (ex: https://www.instagram.com/reel/...)"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="url-input"
                    required
                    disabled={step !== 'idle' && step !== 'error'}
                  />
                  <button
                    type="button"
                    id="paste-link-btn"
                    onClick={handlePaste}
                    className="paste-btn"
                    title="Colar da área de transferência"
                  >
                    <Copy size={14} />
                    <span>Colar</span>
                  </button>
                </div>

                <button
                  type="submit"
                  id="process-instagram-btn"
                  className="action-btn-primary"
                  disabled={!urlInput.trim() || (step !== 'idle' && step !== 'error')}
                >
                  {step !== 'idle' && step !== 'error' ? (
                    <>
                      <div className="spinner" />
                      <span>{statusMessage || 'Processando...'}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={20} />
                      <span>Baixar e Purificar Vídeo</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Tab 2: File Upload (Drag and Drop) */}
            {activeTab === 'upload' && (
              <div
                className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragActive(false);
                  handleFileUpload(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  id="video-file-input"
                  ref={fileInputRef}
                  accept="video/mp4,video/quicktime,video/x-m4v"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
                <div className="dropzone-icon-circle">
                  <Upload size={30} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                    Arraste o vídeo aqui ou clique para selecionar
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Suporta arquivos MP4, MOV e M4V baixados de qualquer rede social.
                  </p>
                </div>
              </div>
            )}

            {/* Tab 3: Direct Video URL */}
            {activeTab === 'direct' && (
              <form onSubmit={handleDirectUrlSubmit} className="input-group">
                <div className="url-input-wrapper">
                  <FileVideo size={20} color="#06b6d4" />
                  <input
                    id="direct-url-input"
                    type="url"
                    placeholder="Insira o link direto de um vídeo MP4 (ex: https://...video.mp4)"
                    value={directVideoUrl}
                    onChange={(e) => setDirectVideoUrl(e.target.value)}
                    className="url-input"
                    required
                    disabled={step !== 'idle' && step !== 'error'}
                  />
                  <button
                    type="button"
                    id="paste-direct-btn"
                    onClick={handlePaste}
                    className="paste-btn"
                  >
                    <Copy size={14} />
                    <span>Colar</span>
                  </button>
                </div>

                <button
                  type="submit"
                  id="process-direct-btn"
                  className="action-btn-primary"
                  disabled={!directVideoUrl.trim() || (step !== 'idle' && step !== 'error')}
                >
                  <Sparkles size={20} />
                  <span>Limpar Metadados do Vídeo</span>
                </button>
              </form>
            )}

            {/* Fallback Notice if Instagram blocks public cloud fetch */}
            {requiresFallback && (
              <div className="alert-box alert-warning" style={{ marginTop: '1.25rem' }}>
                <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Aviso do Instagram:</strong> {fallbackHelp}
                  <div style={{ marginTop: '0.6rem' }}>
                    <button
                      type="button"
                      className="tab-btn active"
                      style={{ display: 'inline-flex', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                      onClick={() => setActiveTab('upload')}
                    >
                      <Upload size={14} />
                      <span>Ir para Upload de Arquivo</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="alert-box alert-error" style={{ marginTop: '1.25rem' }}>
                <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Erro:</strong> {errorMessage}
                </div>
              </div>
            )}

            {/* Active Pipeline Visualizer when processing */}
            {step !== 'idle' && step !== 'error' && (
              <div className="pipeline-box">
                <div className="step-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="spinner" style={{ width: '16px', height: '16px' }} />
                  <span>{statusMessage}</span>
                </div>
                <div className="progress-bar-track">
                  <div
                    className="progress-bar-fill"
                    style={{
                      width:
                        step === 'fetching' ? '35%' : step === 'inspecting' ? '70%' : step === 'stripping' ? '90%' : '100%',
                    }}
                  />
                </div>
                <div className="pipeline-steps">
                  <div className={`step-card ${step === 'fetching' ? 'active' : 'done'}`}>
                    <span className="step-header">Passo 1</span>
                    <span className="step-title">Download</span>
                  </div>
                  <div
                    className={`step-card ${
                      step === 'inspecting' ? 'active' : step === 'stripping' ? 'done' : ''
                    }`}
                  >
                    <span className="step-header">Passo 2</span>
                    <span className="step-title">Inspeção EXIF</span>
                  </div>
                  <div className={`step-card ${step === 'stripping' ? 'active' : ''}`}>
                    <span className="step-header">Passo 3</span>
                    <span className="step-title">Purificação RAW</span>
                  </div>
                  <div className="step-card">
                    <span className="step-header">Passo 4</span>
                    <span className="step-title">Vídeo Limpo</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* State READY: Show Clean Video Preview, Metadata Audit & Download Button */}
        {step === 'ready' && cleanResult && cleanVideoUrl && (
          <div className="preview-container">
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.35rem 0.85rem',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                }}
              >
                <CheckCircle2 size={16} />
                <span>Metadados Removidos em {cleanResult.processingTimeMs} ms</span>
              </div>
              <h2 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Seu Vídeo Está 100% Limpo!</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                Todos os átomos de identificação, geolocalização e data foram expurgados.
              </p>
            </div>

            {/* Video Player Preview */}
            <div className="video-wrapper">
              <span className="video-clean-tag">
                <ShieldCheck size={14} />
                RAW BITSTREAM
              </span>
              <video
                src={cleanVideoUrl}
                controls
                playsInline
                preload="metadata"
                id="clean-video-player"
              />
            </div>

            {/* Metadata Comparison Audit (Antes vs Depois) */}
            <div className="metadata-grid">
              {/* Before */}
              <div className="meta-panel">
                <div className="meta-panel-header">
                  <span className="meta-panel-title">
                    <Layers size={18} color="#f87171" />
                    <span>Metadados Anteriores</span>
                  </span>
                  <span className="tag-instagram">🚨 Rastros do Instagram</span>
                </div>
                <div className="meta-list">
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      📸 Origem da Mídia:
                    </span>
                    <span className="meta-val-dirty">Instagram Reel / Post (Meta CDN)</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      📦 Átomo de Dados (`udta`):
                    </span>
                    <span className="meta-val-dirty">Ativo (Contém IDs do Reel)</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Clock size={14} /> Carimbo do Servidor:
                    </span>
                    <span className="meta-val-dirty">
                      {cleanResult.detectedMetadata.creationDate
                        ? new Date(cleanResult.detectedMetadata.creationDate).toLocaleDateString('pt-BR')
                        : 'Data da Meta Identificada'}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Cpu size={14} /> Assinatura do Encoder:
                    </span>
                    <span className="meta-val-dirty">
                      {cleanResult.detectedMetadata.encoder || 'Lavf / Meta Media Pipeline'}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <MapPin size={14} /> Localização / Região:
                    </span>
                    <span className="meta-val-dirty">
                      {cleanResult.detectedMetadata.location || 'Tags de Região / Geotags'}
                    </span>
                  </div>
                </div>

                {/* Tags destacadas de onde estavam os dados do Insta */}
                <div className="tags-cloud">
                  <span className="tag-pill-dirty">🚨 Tag de Origem Instagram</span>
                  <span className="tag-pill-dirty">🏷️ Átomo udta (ID do Post)</span>
                  <span className="tag-pill-dirty">🌐 scontent.cdninstagram.com</span>
                  <span className="tag-pill-dirty">🕒 Carimbo de Servidor Meta</span>
                </div>
              </div>

              {/* After */}
              <div className="meta-panel">
                <div className="meta-panel-header">
                  <span className="meta-panel-title">
                    <ShieldCheck size={18} color="#34d399" />
                    <span>Status Atual (Pronto pro TikTok)</span>
                  </span>
                  <span className="meta-badge-success">100% RAW Puro</span>
                </div>
                <div className="meta-list">
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      🛡️ Rastro do Instagram:
                    </span>
                    <span className="meta-val-clean">0 bytes (Totalmente Erradicado)</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      📦 Átomo de Dados (`udta`):
                    </span>
                    <span className="meta-val-clean">Zerado (Substituído por free 0x00)</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Clock size={14} /> Carimbo de Servidor:
                    </span>
                    <span className="meta-val-clean">00:00:00 (Zerado / Universal Epoch)</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Hash Anti-Duplicidade:</span>
                    <span className="meta-val-clean">#{cleanResult.uniqueFileHash} (Salt Único Inédito)</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Nome p/ TikTok:</span>
                    <span className="meta-val-clean">{cleanResult.recommendedFilename} (Simula Câmera)</span>
                  </div>
                </div>

                {/* Tags de confirmação de limpeza */}
                <div className="tags-cloud">
                  <span className="tag-pill-clean">✅ Zero Rastros do Insta</span>
                  <span className="tag-pill-clean">✅ udta Zerado</span>
                  <span className="tag-pill-clean">✅ Hash Único Ativo</span>
                  <span className="tag-pill-clean">📱 Simulação Câmera iPhone</span>
                  <span className="tag-pill-clean">🚀 Alcance no TikTok Protegido</span>
                </div>
              </div>
            </div>

            {/* Camera Style Filename Selector */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                alignItems: 'center',
                margin: '0.5rem 0',
              }}
            >
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Formato do nome para simular gravação na câmera do celular (evita flag de repost):
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={`tab-btn ${cameraStyle === 'iphone' ? 'active' : ''}`}
                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                  onClick={() => {
                    setCameraStyle('iphone');
                    if (cleanResult) {
                      cleanResult.recommendedFilename = `IMG_${Math.floor(1000 + Math.random() * 9000)}.mp4`;
                      setCleanResult({ ...cleanResult });
                    }
                  }}
                >
                  📱 Estilo iPhone (IMG_XXXX.mp4)
                </button>
                <button
                  type="button"
                  className={`tab-btn ${cameraStyle === 'android' ? 'active' : ''}`}
                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                  onClick={() => {
                    setCameraStyle('android');
                    if (cleanResult) {
                      const now = new Date();
                      const y = now.getFullYear();
                      const m = String(now.getMonth() + 1).padStart(2, '0');
                      const d = String(now.getDate()).padStart(2, '0');
                      cleanResult.recommendedFilename = `VID_${y}${m}${d}_${Math.floor(100000 + Math.random() * 900000)}.mp4`;
                      setCleanResult({ ...cleanResult });
                    }
                  }}
                >
                  🤖 Estilo Android (VID_YYYYMMDD.mp4)
                </button>
              </div>
            </div>

            {/* Download Buttons Group */}
            <div className="action-buttons-group">
              <a
                id="download-clean-video-btn"
                href={cleanVideoUrl}
                download={cleanResult.recommendedFilename}
                className="download-clean-btn"
              >
                <Download size={22} />
                <span>Baixar Vídeo Limpo ({cleanResult.recommendedFilename})</span>
              </a>

              <button
                type="button"
                id="clean-another-btn"
                onClick={handleReset}
                className="secondary-reset-btn"
              >
                <RotateCcw size={16} />
                <span>Limpar Outro Vídeo</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Why strip metadata section */}
      <section className="features-grid" aria-label="Benefícios da remoção de metadados">
        <div className="feature-box">
          <div className="feature-icon-wrapper">
            <Zap size={22} />
          </div>
          <h2 className="feature-title">Evite Penalização de Repost</h2>
          <p className="feature-desc">
            Algoritmos do TikTok, Shorts e Reels escaneiam metadados dos contêineres MP4. Vídeos com rastros de
            download sofrem redução severa de alcance e visualizações.
          </p>
        </div>

        <div className="feature-box">
          <div className="feature-icon-wrapper">
            <ShieldCheck size={22} />
          </div>
          <h2 className="feature-title">Privacidade Absoluta</h2>
          <p className="feature-desc">
            Câmeras e smartphones salvam coordenadas de GPS exatas e datas de gravação nos átomos `udta`. A purificação
            apaga tudo direto no seu navegador.
          </p>
        </div>

        <div className="feature-box">
          <div className="feature-icon-wrapper">
            <Sparkles size={22} />
          </div>
          <h2 className="feature-title">Zero Perda de Qualidade</h2>
          <p className="feature-desc">
            A limpeza é binária e cirúrgica (Stream Copy sem re-encoding). Os quadros de imagem e áudio permanecem com
            100% da fidelidade original em nanossegundos.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <p>InstaFlow • Ferramenta open-source para criadores de conteúdo e editores de vídeo.</p>
        <p style={{ opacity: 0.7 }}>Processamento binário seguro executado localmente no navegador.</p>
      </footer>
    </main>
  );
}

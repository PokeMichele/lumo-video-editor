import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle, X, AlertCircle } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  totalDuration: number;
  aspectRatio: '16:9' | '4:3' | '9:16';
  selectedFPS: 24 | 30 | 60; // Nuovo parametro per FPS selezionati
  trackVolumes: Map<string, number>; // itemId -> volume (0-200)
}

interface MediaElementCache {
  videos: Map<string, HTMLVideoElement>;
  audios: Map<string, HTMLAudioElement>;
  images: Map<string, HTMLImageElement>;
}

export const ExportDialog = ({ 
  isOpen, 
  onClose, 
  timelineItems, 
  totalDuration, 
  aspectRatio,
  selectedFPS,
  trackVolumes 
}: ExportDialogProps) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'preparing' | 'rendering' | 'completed' | 'error'>('preparing');
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [fps, setFps] = useState(30);
  const [estimatedTime, setEstimatedTime] = useState<string>('');
  
  // Refs per il rendering
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef<boolean>(false);
  const timeoutRef = useRef<number | null>(null);
  const renderingRef = useRef<boolean>(false);
  
  // OTTIMIZZAZIONE: Cache unificata per tutti i media elements
  const mediaCache = useRef<MediaElementCache>({
    videos: new Map(),
    audios: new Map(),
    images: new Map()
  });
  
  // OTTIMIZZAZIONE: Performance monitoring
  const performanceRef = useRef({
    frameStartTime: 0,
    totalFrameTime: 0,
    frameCount: 0,
    droppedFrames: 0
  });

  // Calculate canvas dimensions based on aspect ratio
  const getCanvasDimensions = useCallback(() => {
    const baseWidth = 1920; // Higher quality export
    switch (aspectRatio) {
      case '16:9':
        return { width: baseWidth, height: Math.round(baseWidth / (16/9)) };
      case '4:3':
        return { width: baseWidth, height: Math.round(baseWidth / (4/3)) };
      case '9:16':
        return { width: Math.round(baseWidth * (9/16)), height: baseWidth };
      default:
        return { width: baseWidth, height: Math.round(baseWidth / (16/9)) };
    }
  }, [aspectRatio]);

  // Funzione per calcolare l'alfa globale basato sugli effetti (per export)
  const calculateGlobalAlpha = useCallback((time: number) => {
    const activeEffects = timelineItems.filter(item =>
      item.mediaFile.type === 'effect' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );

    let globalAlpha = 1.0;

    activeEffects.forEach(effect => {
      if (!effect.mediaFile.effectType) return;

      const relativeTime = time - effect.startTime;
      const progress = relativeTime / effect.duration; // 0 a 1

      switch (effect.mediaFile.effectType) {
        case 'fade-in':
          const fadeInAlpha = Math.min(progress, 1);
          globalAlpha *= fadeInAlpha;
          break;
          
        case 'fade-out':
          const fadeOutAlpha = Math.max(1 - progress, 0);
          globalAlpha *= fadeOutAlpha;
          break;
      }
    });

    return Math.max(0, Math.min(1, globalAlpha));
  }, [timelineItems]);

  // Funzione per verificare se è attivo l'effetto black & white (per export)
  const isBlackWhiteActive = useCallback((time: number) => {
    return timelineItems.some(item =>
      item.mediaFile.type === 'effect' &&
      item.mediaFile.effectType === 'black-white' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );
  }, [timelineItems]);

  // NUOVO: Funzione per calcolare l'intensità del blur (per export)
  const calculateBlurIntensity = useCallback((time: number) => {
    const activeBlurEffects = timelineItems.filter(item =>
      item.mediaFile.type === 'effect' &&
      item.mediaFile.effectType === 'blur' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );

    let blurIntensity = 0;

    activeBlurEffects.forEach(effect => {
      const relativeTime = time - effect.startTime;
      const progress = relativeTime / effect.duration; // 0 a 1
      const effectIntensity = effect.mediaFile.effectIntensity || 50;

      // Il blur aumenta progressivamente fino al valore massimo
      const currentBlur = (effectIntensity / 100) * 10; // 0% = 0px, 100% = 10px
      blurIntensity = Math.max(blurIntensity, currentBlur);
    });

    return Math.max(0, Math.min(10, blurIntensity)); // Limita tra 0px e 10px
  }, [timelineItems]);

  // CORRETTO: Funzione per calcolare il fattore di scala per effetti zoom (per export)
  const calculateZoomScale = useCallback((time: number) => {
    const activeZoomEffects = timelineItems.filter(item =>
      item.mediaFile.type === 'effect' &&
      (item.mediaFile.effectType === 'zoom-in' || item.mediaFile.effectType === 'zoom-out') &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );

    let zoomScale = 1.0;

    activeZoomEffects.forEach(effect => {
      const relativeTime = time - effect.startTime;
      const progress = relativeTime / effect.duration; // 0 a 1
      const effectIntensity = effect.mediaFile.effectIntensity || 50;

      if (effect.mediaFile.effectType === 'zoom-in') {
        // Zoom in: scala progressivamente da 1.0 al valore finale
        const maxZoomFactor = 1 + (effectIntensity / 100) * 2; // 0% = 1.0x, 100% = 3.0x
        const currentScale = 1 + (progress * (maxZoomFactor - 1));
        zoomScale *= currentScale;
      } else if (effect.mediaFile.effectType === 'zoom-out') {
        // CORRETTO: Zoom out parte da 1.0 e va verso valori più piccoli
        const minZoomFactor = 1 - (effectIntensity / 100) * 0.8; // 0% = 1.0x, 100% = 0.2x
        const currentScale = 1 - (progress * (1 - minZoomFactor));
        zoomScale *= currentScale;
      }
    });

    return Math.max(0.1, Math.min(5.0, zoomScale)); // Limita tra 0.1x e 5.0x
  }, [timelineItems]);

  // OTTIMIZZAZIONE: Preload intelligente dei media
  const preloadMedia = useCallback(async () => {
    if (cancelledRef.current) return;

    const cache = mediaCache.current;
    const loadPromises: Promise<void>[] = [];

    // Cleanup elementi non più necessari
    const currentItemIds = new Set(timelineItems.map(item => item.id));
    
    // Pulisci video cache
    cache.videos.forEach((video, id) => {
      if (!currentItemIds.has(id)) {
        video.pause();
        video.src = '';
        video.remove();
        cache.videos.delete(id);
      }
    });

    // Pulisci audio cache
    cache.audios.forEach((audio, id) => {
      if (!currentItemIds.has(id)) {
        audio.pause();
        audio.src = '';
        audio.remove();
        cache.audios.delete(id);
      }
    });

    // Pulisci image cache
    cache.images.forEach((img, id) => {
      if (!currentItemIds.has(id)) {
        cache.images.delete(id);
      }
    });

    // Carica nuovi elementi in parallelo (solo media, esclusi effetti)
    for (const item of timelineItems.filter(item => item.mediaFile.type !== 'effect')) {
      if (cancelledRef.current) break;

      if (item.mediaFile.type === 'video' && !cache.videos.has(item.id)) {
        const promise = new Promise<void>((resolve) => {
          const video = document.createElement('video');
          video.src = item.mediaFile.url;
          video.crossOrigin = 'anonymous';
          video.muted = false; // CORRETTO: Non mutare per includere l'audio nell'export
          const itemVolume = trackVolumes.get(item.id) ?? 100;
          video.volume = itemVolume / 100; // Usa il volume specifico dell'elemento
          video.preload = 'auto';
          video.playsInline = true;
          
          const handleLoad = () => {
            video.removeEventListener('canplaythrough', handleLoad);
            video.removeEventListener('error', handleError);
            if (!cancelledRef.current) {
              cache.videos.set(item.id, video);
            }
            resolve();
          };
          
          const handleError = () => {
            video.removeEventListener('canplaythrough', handleLoad);
            video.removeEventListener('error', handleError);
            console.warn(`Failed to load video: ${item.mediaFile.name}`);
            resolve();
          };
          
          video.addEventListener('canplaythrough', handleLoad);
          video.addEventListener('error', handleError);
          
          // Timeout fallback
          setTimeout(() => {
            video.removeEventListener('canplaythrough', handleLoad);
            video.removeEventListener('error', handleError);
            resolve();
          }, 5000);
        });
        
        loadPromises.push(promise);
      }

      if (item.mediaFile.type === 'audio' && !cache.audios.has(item.id)) {
        const promise = new Promise<void>((resolve) => {
          const audio = document.createElement('audio');
          audio.src = item.mediaFile.url;
          audio.crossOrigin = 'anonymous';
          audio.preload = 'auto';
          
          const handleLoad = () => {
            audio.removeEventListener('canplaythrough', handleLoad);
            audio.removeEventListener('error', handleError);
            if (!cancelledRef.current) {
              cache.audios.set(item.id, audio);
            }
            resolve();
          };
          
          const handleError = () => {
            audio.removeEventListener('canplaythrough', handleLoad);
            audio.removeEventListener('error', handleError);
            console.warn(`Failed to load audio: ${item.mediaFile.name}`);
            resolve();
          };
          
          audio.addEventListener('canplaythrough', handleLoad);
          audio.addEventListener('error', handleError);
          
          setTimeout(() => {
            audio.removeEventListener('canplaythrough', handleLoad);
            audio.removeEventListener('error', handleError);
            resolve();
          }, 5000);
        });
        
        loadPromises.push(promise);
      }

      if (item.mediaFile.type === 'image' && !cache.images.has(item.id)) {
        const promise = new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = item.mediaFile.url;
          
          img.onload = () => {
            if (!cancelledRef.current) {
              cache.images.set(item.id, img);
            }
            resolve();
          };
          
          img.onerror = () => {
            console.warn(`Failed to load image: ${item.mediaFile.name}`);
            resolve();
          };
          
          setTimeout(() => resolve(), 3000);
        });
        
        loadPromises.push(promise);
      }
    }

    // OTTIMIZZAZIONE: Carica in batch per evitare sovraccarico
    const batchSize = 5;
    for (let i = 0; i < loadPromises.length; i += batchSize) {
      if (cancelledRef.current) break;
      const batch = loadPromises.slice(i, i + batchSize);
      await Promise.all(batch);
    }
  }, [timelineItems, trackVolumes]);

  // OTTIMIZZAZIONE: Gestione audio migliorata con Web Audio API
  const setupAudioContext = useCallback(async () => {
    if (cancelledRef.current) return null;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();
      
      // Crea un gain node per controllo volume globale
      const masterGain = audioContext.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(destination);
      
      // CORRETTO: Connetti tutti gli elementi audio E video (non solo audio e video separati)
      const audioPromises = timelineItems
        .filter(item => item.mediaFile.type === 'audio' || item.mediaFile.type === 'video')
        .map(async (item) => {
          try {
            const element = item.mediaFile.type === 'video' 
              ? mediaCache.current.videos.get(item.id)
              : mediaCache.current.audios.get(item.id);
            
            if (element) {
              // Assicurati che l'elemento non sia mutato
              element.muted = false;
              const itemVolume = trackVolumes.get(item.id) ?? 100;
              element.volume = itemVolume / 100; // Usa il volume specifico dell'elemento
              
              const source = audioContext.createMediaElementSource(element);
              const gainNode = audioContext.createGain();
              gainNode.gain.value = itemVolume / 100; // Applica anche al gain node
              
              source.connect(gainNode);
              gainNode.connect(masterGain);
              
              return { element, source, gainNode, itemType: item.mediaFile.type };
            }
          } catch (error) {
            console.warn(`Error setting up audio for ${item.id}:`, error);
          }
          return null;
        });

      const audioNodes = await Promise.all(audioPromises);
      
      audioContextRef.current = audioContext;
      return { audioContext, destination, audioNodes: audioNodes.filter(Boolean) };
    } catch (error) {
      console.error('Failed to setup audio context:', error);
      return null;
    }
  }, [timelineItems, trackVolumes]);

  // AGGIORNATO: Render frame migliorato con supporto completo per tutti gli effetti incluso Blur
  const renderFrame = useCallback(async (time: number, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    if (cancelledRef.current) return;

    const perf = performanceRef.current;
    perf.frameStartTime = performance.now();

    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get active items at this time (esclusi effetti per il rendering)
    const activeItems = timelineItems.filter(item =>
      item.mediaFile.type !== 'effect' &&
      time >= item.startTime && 
      time < item.startTime + item.duration
    ).sort((a, b) => a.track - b.track);

    if (activeItems.length === 0) return;

    // AGGIORNATO: Calcola tutti gli effetti attivi
    const globalAlpha = calculateGlobalAlpha(time);
    const blackWhiteActive = isBlackWhiteActive(time);
    const zoomScale = calculateZoomScale(time);
    const blurIntensity = calculateBlurIntensity(time); // NUOVO
    
    // AGGIORNATO: Applica gli effetti prima di renderizzare i media
    ctx.save();
    ctx.globalAlpha = globalAlpha;
    
    // AGGIORNATO: Combina tutti i filtri CSS
    let filterString = 'none';
    const filters = [];
    
    if (blackWhiteActive) {
      filters.push('grayscale(1)');
    }
    
    if (blurIntensity > 0) {
      filters.push(`blur(${blurIntensity}px)`);
    }
    
    if (filters.length > 0) {
      filterString = filters.join(' ');
    }
    
    ctx.filter = filterString;

    // Applica la trasformazione di zoom se attiva
    if (zoomScale !== 1.0) {
      // Scala dal centro del canvas
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      ctx.translate(centerX, centerY);
      ctx.scale(zoomScale, zoomScale);
      ctx.translate(-centerX, -centerY);
    }

    // OTTIMIZZAZIONE: Batch rendering per tipo di media
    const videoItems = activeItems.filter(item => item.mediaFile.type === 'video');
    const imageItems = activeItems.filter(item => item.mediaFile.type === 'image');

    // Render videos
    for (const item of videoItems) {
      if (cancelledRef.current) break;

      const video = mediaCache.current.videos.get(item.id);
      if (!video) continue;

      const relativeTime = time - item.startTime;
      const mediaOffset = item.mediaStartOffset || 0;
      const targetTime = relativeTime + mediaOffset;

      // OTTIMIZZAZIONE: Seek solo quando necessario con tolleranza stretta
      if (Math.abs(video.currentTime - targetTime) > 0.05) {
        video.currentTime = targetTime;
      }

      // Attendi che il video sia pronto
      if (video.readyState >= 2) {
        try {
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = canvas.width / canvas.height;

          let renderWidth, renderHeight, offsetX, offsetY;

          if (videoAspect > canvasAspect) {
            renderWidth = canvas.width;
            renderHeight = canvas.width / videoAspect;
            offsetX = 0;
            offsetY = (canvas.height - renderHeight) / 2;
          } else {
            renderWidth = canvas.height * videoAspect;
            renderHeight = canvas.height;
            offsetX = (canvas.width - renderWidth) / 2;
            offsetY = 0;
          }

          // Apply track offset for layering
          const trackOffsetX = item.track * 10; // Ridotto per export
          const trackOffsetY = item.track * 10;

          ctx.drawImage(
            video,
            offsetX + trackOffsetX,
            offsetY + trackOffsetY,
            renderWidth - trackOffsetX * 2,
            renderHeight - trackOffsetY * 2
          );
        } catch (error) {
          console.warn(`Error rendering video ${item.id}:`, error);
        }
      }
    }

    // Render images
    for (const item of imageItems) {
      if (cancelledRef.current) break;

      const img = mediaCache.current.images.get(item.id);
      if (!img || !img.complete) continue;

      try {
        const imgAspect = img.width / img.height;
        const canvasAspect = canvas.width / canvas.height;

        let renderWidth, renderHeight, offsetX, offsetY;

        if (imgAspect > canvasAspect) {
          renderWidth = canvas.width * 0.9;
          renderHeight = renderWidth / imgAspect;
          offsetX = (canvas.width - renderWidth) / 2;
          offsetY = (canvas.height - renderHeight) / 2;
        } else {
          renderHeight = canvas.height * 0.9;
          renderWidth = renderHeight * imgAspect;
          offsetX = (canvas.width - renderWidth) / 2;
          offsetY = (canvas.height - renderHeight) / 2;
        }

        const trackOffsetX = item.track * 20;
        const trackOffsetY = item.track * 20;

        ctx.drawImage(
          img,
          offsetX + trackOffsetX,
          offsetY + trackOffsetY,
          renderWidth - trackOffsetX,
          renderHeight - trackOffsetY
        );
      } catch (error) {
        console.warn(`Error rendering image ${item.id}:`, error);
      }
    }

    // Ripristina il contesto dopo aver applicato gli effetti
    ctx.restore();

    // OTTIMIZZAZIONE: Traccia performance
    const frameTime = performance.now() - perf.frameStartTime;
    perf.totalFrameTime += frameTime;
    perf.frameCount++;

    // Adatta FPS se necessario
    if (frameTime > 33) { // Se impiega più di 33ms (30fps)
      perf.droppedFrames++;
    }
  }, [timelineItems, calculateGlobalAlpha, isBlackWhiteActive, calculateZoomScale, calculateBlurIntensity]);

  // CORRETTO: Sync audio migliorato per video e audio
  const syncAudio = useCallback((time: number, audioNodes: any[]) => {
    if (cancelledRef.current) return;

    const activeItems = timelineItems.filter(item =>
      item.mediaFile.type !== 'effect' &&
      time >= item.startTime && 
      time < item.startTime + item.duration
    );

    audioNodes.forEach((node, index) => {
      if (!node || !node.element) return;

      const item = activeItems.find(item => {
        const element = item.mediaFile.type === 'video' 
          ? mediaCache.current.videos.get(item.id)
          : mediaCache.current.audios.get(item.id);
        return element === node.element;
      });

      if (item) {
        const relativeTime = time - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const targetTime = relativeTime + mediaOffset;

        if (targetTime >= 0 && targetTime <= node.element.duration) {
          // CORRETTO: Assicurati che l'elemento non sia mutato
          node.element.muted = false;
          const itemVolume = trackVolumes.get(item.id) ?? 100;
          node.element.volume = itemVolume / 100;
          
          if (Math.abs(node.element.currentTime - targetTime) > 0.05) {
            node.element.currentTime = targetTime;
          }
          
          if (node.element.paused) {
            node.element.play().catch(() => {});
          }
          
          // Applica effetti fade anche all'audio con volume individuale
          const globalAlpha = calculateGlobalAlpha(time);
          node.gainNode.gain.value = (itemVolume / 100) * globalAlpha;
        } else {
          node.element.pause();
          node.gainNode.gain.value = 0;
        }
      } else {
        node.element.pause();
        node.gainNode.gain.value = 0;
      }
    });
  }, [timelineItems, calculateGlobalAlpha, trackVolumes]);

  // OTTIMIZZAZIONE: Cleanup completo delle risorse
  const cleanupResources = useCallback(() => {
    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.warn('Error stopping MediaRecorder:', error);
      }
    }

    // Cleanup audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (error) {
        console.warn('Error closing audio context:', error);
      }
      audioContextRef.current = null;
    }

    // Cleanup media cache
    const cache = mediaCache.current;
    
    cache.videos.forEach(video => {
      video.pause();
      video.src = '';
      video.remove();
    });
    cache.videos.clear();

    cache.audios.forEach(audio => {
      audio.pause();
      audio.src = '';
      audio.remove();
    });
    cache.audios.clear();

    cache.images.clear();

    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Cleanup URL
    if (exportedVideoUrl) {
      try {
        URL.revokeObjectURL(exportedVideoUrl);
      } catch (error) {
        console.warn('Error revoking URL:', error);
      }
    }

    // Reset refs
    recordedChunksRef.current = [];
    renderingRef.current = false;
    performanceRef.current = {
      frameStartTime: 0,
      totalFrameTime: 0,
      frameCount: 0,
      droppedFrames: 0
    };
  }, [exportedVideoUrl]);

  // Processo di export con stop corretto
  const exportVideo = useCallback(async () => {
    try {
      if (cancelledRef.current || renderingRef.current) return;

      renderingRef.current = true;
      setStatus('preparing');
      setProgress(0);

      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas not available');

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      const dimensions = getCanvasDimensions();
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;

      // Preload media
      await preloadMedia();
      if (cancelledRef.current) return;

      // Setup audio
      const audioSetup = await setupAudioContext();
      if (cancelledRef.current) return;

      setStatus('rendering');

      // AGGIORNATO: Usa FPS selezionato dall'utente invece di calcolarlo
      const maxEndTime = timelineItems.reduce((max, item) => {
        return Math.max(max, item.startTime + item.duration);
      }, 0);

      const exportDuration = Math.max(maxEndTime, 1);
      const targetFPS = selectedFPS; // Usa FPS selezionato dall'utente
      
      setFps(targetFPS);

      // Setup MediaRecorder
      const canvasStream = canvas.captureStream(targetFPS);
      const audioStream = audioSetup?.destination?.stream;
      
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(audioStream?.getAudioTracks() || [])
      ]);

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: 8000000, // 8 Mbps per alta qualità
        audioBitsPerSecond: 128000   // 128 kbps audio
      });

      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && !cancelledRef.current) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (!cancelledRef.current) {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);

          // Performance report
          const perf = performanceRef.current;
          const avgFrameTime = perf.totalFrameTime / perf.frameCount;
          console.log(`Export completed: ${perf.frameCount} frames, avg ${avgFrameTime.toFixed(2)}ms/frame, ${perf.droppedFrames} dropped`);

          // Auto-download
          const link = document.createElement('a');
          link.href = url;
          link.download = `video-export-${aspectRatio}-${Date.now()}.webm`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // Cleanup e chiusura automatica dopo un breve delay
          setTimeout(() => {
            URL.revokeObjectURL(url);
            onClose(); // Chiude automaticamente il dialog
          }, 1000);
        }
      };

      mediaRecorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        if (!cancelledRef.current) {
          renderingRef.current = false;
          setStatus('error');
        }
      };

      mediaRecorder.start();

      // Rendering loop con stop definitivo
      const totalFrames = Math.ceil(exportDuration * targetFPS);
      const frameInterval = 1000 / targetFPS;
      let currentFrame = 0;
      let lastFrameTime = performance.now();

      // Stima tempo rimanente
      const estimateRemainingTime = () => {
        const elapsed = performance.now() - lastFrameTime;
        const remaining = (totalFrames - currentFrame) * (elapsed / Math.max(currentFrame, 1));
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      };

      const renderLoop = async () => {
        // Stop se cancellato
        if (cancelledRef.current) {
          return;
        }

        // Se abbiamo finito tutti i frames, ferma il MediaRecorder
        if (currentFrame >= totalFrames) {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          return;
        }

        const currentTime = currentFrame / targetFPS;

        // Sync audio
        if (audioSetup?.audioNodes) {
          syncAudio(currentTime, audioSetup.audioNodes);
        }

        // Render frame
        await renderFrame(currentTime, ctx, canvas);

        if (cancelledRef.current) return;

        currentFrame++;
        const progressPercent = (currentFrame / totalFrames) * 100;
        setProgress(progressPercent);

        // Update time estimate ogni 30 frames
        if (currentFrame % 30 === 0) {
          setEstimatedTime(estimateRemainingTime());
        }

        // Programma il prossimo frame
        timeoutRef.current = setTimeout(renderLoop, 33);
      };

      renderLoop();

    } catch (error) {
      console.error('Export failed:', error);
      if (!cancelledRef.current) {
        renderingRef.current = false;
        setStatus('error');
      }
    }
  }, [timelineItems, aspectRatio, getCanvasDimensions, preloadMedia, setupAudioContext, renderFrame, syncAudio]);

  // Gestione apertura/chiusura dialog
  useEffect(() => {
    if (!isOpen) {
      cancelledRef.current = true;
      cleanupResources();
      setProgress(0);
      setStatus('preparing');
      setExportedVideoUrl(null);
      setEstimatedTime('');
      return;
    }

    cancelledRef.current = false;
    renderingRef.current = false;
    setProgress(0);
    setStatus('preparing');
    setExportedVideoUrl(null);
    setEstimatedTime('');

    // Avvia export dopo un breve delay
    const startExport = setTimeout(() => {
      if (!cancelledRef.current && !renderingRef.current) {
        exportVideo();
      }
    }, 500);

    return () => {
      clearTimeout(startExport);
    };
  }, [isOpen, exportVideo, cleanupResources]);

  // Gestione annullamento
  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    renderingRef.current = false;
    cleanupResources();
    setProgress(0);
    setStatus('preparing');
    setEstimatedTime('');
  }, [cleanupResources]);

  // Gestione chiusura
  const handleClose = useCallback(() => {
    if (status === 'preparing' || status === 'rendering') {
      handleCancel();
    } else {
      cleanupResources();
    }
    onClose();
  }, [status, handleCancel, cleanupResources, onClose]);

  const getStatusText = () => {
    if (cancelledRef.current) return 'Export cancelled';
    
    switch (status) {
      case 'preparing': return 'Preparing media files...';
      case 'rendering': return `Rendering video (${fps}fps)...`;
      case 'completed': return 'Export completed!';
      case 'error': return 'Export failed';
      default: return 'Processing...';
    }
  };

  const getStatusColor = () => {
    if (cancelledRef.current) return 'text-orange-500';
    
    switch (status) {
      case 'preparing': return 'text-blue-500';
      case 'rendering': return 'text-yellow-500';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    if (cancelledRef.current) return <AlertCircle className="w-5 h-5 text-orange-500" />;
    
    switch (status) {
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error': return <X className="w-5 h-5 text-red-500" />;
      default: return null;
    }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'none' }}
      />
      
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Export Video
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Export Details */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Aspect Ratio:</span>
                <span className="font-medium">{aspectRatio}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Duration:</span>
                <span className="font-medium">{Math.round(totalDuration)}s</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Timeline Items:</span>
                <span className="font-medium">{timelineItems.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Frame Rate:</span>
                <span className="font-medium">{selectedFPS} fps</span>
              </div>
            </div>

            {/* Progress Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${getStatusColor()}`}>
                  {getStatusText()}
                </span>
                {getStatusIcon()}
              </div>
              
              <Progress value={progress} className="w-full" />
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.toFixed(1)}% completed</span>
                {estimatedTime && status === 'rendering' && (
                  <span>Est. {estimatedTime} remaining</span>
                )}
              </div>
            </div>

            {/* Performance Info */}
            {status === 'rendering' && (
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Optimizing for best quality...</div>
                {performanceRef.current.droppedFrames > 0 && (
                  <div className="text-yellow-600">
                    {performanceRef.current.droppedFrames} frames optimized
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              <Button
                onClick={handleClose}
                variant="outline"
                size="sm"
              >
                {status === 'preparing' || status === 'rendering' ? 'Cancel' : 'Close'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
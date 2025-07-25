import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";

interface CompositeVideoPlayerProps {
  timelineItems: TimelineItem[];
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  aspectRatio: '16:9' | '4:3' | '9:16';
  trackVolumes: Map<string, number>; // itemId -> volume (0-200)
}

// AGGIORNATO: Interfaccia per gestire tutti gli effetti attivi
interface ActiveEffect {
  id: string;
  name: string;
  type: string;
  progress: number; // 0 a 1
  intensity: number; // Intensità dell'effetto (0 a 1)
}

export const CompositeVideoPlayer = ({
  timelineItems,
  currentTime,
  isPlaying,
  onTimeUpdate,
  onPlayStateChange,
  aspectRatio,
  trackVolumes
}: CompositeVideoPlayerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVideoContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [volume, setVolume] = useState(100);
  
  // OTTIMIZZAZIONE: Gestione timing migliorata
  const lastRenderTimeRef = useRef<number>(0);
  const lastUpdateTimeRef = useRef<number>(performance.now());
  const needsRenderRef = useRef<boolean>(true);
  
  // OTTIMIZZAZIONE: Cache delle dimensioni canvas
  const canvasDimensions = useMemo(() => {
    const baseWidth = 1280;
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

  // OTTIMIZZAZIONE: Memoizza gli elementi attivi
  const activeItems = useMemo(() => {
    return timelineItems.filter(item =>
      currentTime >= item.startTime &&
      currentTime < item.startTime + item.duration
    ).sort((a, b) => a.track - b.track);
  }, [timelineItems, currentTime]);

  // AGGIORNATO: Funzione per calcolare tutti gli effetti attivi
  const calculateActiveEffects = useCallback((time: number): ActiveEffect[] => {
    const activeEffects = timelineItems.filter(item =>
      item.mediaFile.type === 'effect' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );

    return activeEffects.map(effect => {
      const relativeTime = time - effect.startTime;
      const progress = relativeTime / effect.duration; // 0 a 1
      
      let intensity = 1; // Intensità di default per la maggior parte degli effetti

      switch (effect.mediaFile.effectType) {
        case 'fade-in':
          intensity = Math.min(progress, 1);
          break;
        case 'fade-out':
          intensity = Math.max(1 - progress, 0);
          break;
        case 'black-white':
          intensity = 1; // Sempre attivo
          break;
        case 'zoom-in':
        case 'zoom-out':
        case 'blur':
          intensity = 1; // Per zoom e blur usiamo sempre intensità 1, il valore è calcolato separatamente
          break;
        default:
          intensity = 1;
      }

      return {
        id: effect.id,
        name: effect.mediaFile.name,
        type: effect.mediaFile.effectType || 'unknown',
        progress: Math.min(Math.max(progress, 0), 1),
        intensity: Math.min(Math.max(intensity, 0), 1)
      };
    });
  }, [timelineItems]);

  // Funzione per calcolare l'alfa globale (solo per effetti di fade)
  const calculateGlobalAlpha = useCallback((activeEffects: ActiveEffect[]) => {
    let globalAlpha = 1.0;

    activeEffects.forEach(effect => {
      if (effect.type === 'fade-in' || effect.type === 'fade-out') {
        globalAlpha *= effect.intensity;
      }
    });

    return Math.max(0, Math.min(1, globalAlpha));
  }, []);

  // Funzione per verificare se è attivo l'effetto black & white
  const isBlackWhiteActive = useCallback((activeEffects: ActiveEffect[]) => {
    return activeEffects.some(effect => effect.type === 'black-white');
  }, []);

  // NUOVO: Funzione per calcolare l'intensità del blur attivo
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

      // Il blur aumenta progressivamente fino al valore massimo e rimane costante
      // Durante tutto l'effetto
      const currentBlur = (effectIntensity / 100) * 10; // 0% = 0px, 100% = 10px
      blurIntensity = Math.max(blurIntensity, currentBlur);
    });

    return Math.max(0, Math.min(10, blurIntensity)); // Limita tra 0px e 10px
  }, [timelineItems]);

  // CORRETTO: Funzione per calcolare il fattore di scala per effetti zoom
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

  // AGGIORNATO: Funzione per renderizzare indicatori degli effetti con supporto per tutti gli effetti
  const renderEffectIndicators = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, activeEffects: ActiveEffect[], currentTime: number) => {
    if (activeEffects.length === 0) return;

    // Salva il contesto per gli indicatori
    ctx.save();
    ctx.globalAlpha = 0.8;

    activeEffects.forEach((effect, index) => {
      // Disegna un sottile bordo rosso per indicare l'effetto attivo
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(5 + index * 3, 5 + index * 3, canvasWidth - 10 - index * 6, canvasHeight - 10 - index * 6);
      
      // Testo dell'effetto nell'angolo
      const textY = 25 + index * 25;
      
      // Colore di sfondo specifico per tipo di effetto
      let bgColor = 'rgba(255, 0, 0, 0.9)'; // Default rosso
      if (effect.type === 'black-white') {
        bgColor = 'rgba(128, 128, 128, 0.9)'; // Grigio per black & white
      } else if (effect.type === 'zoom-in' || effect.type === 'zoom-out') {
        bgColor = 'rgba(0, 123, 255, 0.9)'; // Blu per zoom
      } else if (effect.type === 'blur') {
        bgColor = 'rgba(128, 0, 128, 0.9)'; // Viola per blur
      }
      
      ctx.fillStyle = bgColor;
      ctx.fillRect(10, textY - 15, 180, 20);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'left';
      
      // Testo specifico per tipo di effetto
      let displayText = `${effect.name} (${(effect.progress * 100).toFixed(0)}%)`;
      if (effect.type === 'zoom-in' || effect.type === 'zoom-out') {
        const currentZoom = calculateZoomScale(currentTime);
        displayText = `${effect.name} (${currentZoom.toFixed(2)}x)`;
      } else if (effect.type === 'blur') {
        const currentBlur = calculateBlurIntensity(currentTime);
        displayText = `${effect.name} (${currentBlur.toFixed(1)}px)`;
      }
      
      ctx.fillText(displayText, 15, textY);
    });

    ctx.restore();
  }, [calculateZoomScale, calculateBlurIntensity]);

  // OTTIMIZZAZIONE: Throttled render function
  const renderComposite = useCallback(() => {
    const now = performance.now();
    
    // Throttle rendering a max 60fps
    if (now - lastRenderTimeRef.current < 16.67) {
      return;
    }
    
    lastRenderTimeRef.current = now;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas solo se necessario
    if (needsRenderRef.current) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      needsRenderRef.current = false;
    }

    if (activeItems.length === 0) {
      ctx.fillStyle = '#666666';
      ctx.font = '64px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🎬', canvas.width / 2, canvas.height / 2 - 40);
      ctx.font = '24px Arial';
      ctx.fillText('No active media at current time', canvas.width / 2, canvas.height / 2 + 20);
      return;
    }

    // AGGIORNATO: Calcola gli effetti attivi
    const activeEffects = calculateActiveEffects(currentTime);
    const globalAlpha = calculateGlobalAlpha(activeEffects);
    const blackWhiteActive = isBlackWhiteActive(activeEffects);
    const zoomScale = calculateZoomScale(currentTime);
    const blurIntensity = calculateBlurIntensity(currentTime); // NUOVO
    
    // Separa gli elementi media dagli effetti
    const mediaItems = activeItems.filter(item => item.mediaFile.type !== 'effect');

    // AGGIORNATO: Applica gli effetti prima di renderizzare i media
    ctx.save();
    
    // Applica l'alfa globale per gli effetti di fade
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

    // Renderizza tutti gli elementi media con gli effetti applicati
    mediaItems.forEach(item => {
      const relativeTime = currentTime - item.startTime;
      
      try {
        if (item.mediaFile.type === 'video') {
          const video = videoElementsRef.current.get(item.id);
          if (video && video.readyState >= 2) {
            // OTTIMIZZAZIONE: Cache delle dimensioni di rendering
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

            const trackOffsetX = item.track * 20;
            const trackOffsetY = item.track * 20;

            ctx.drawImage(
              video,
              offsetX + trackOffsetX,
              offsetY + trackOffsetY,
              renderWidth - trackOffsetX * 2,
              renderHeight - trackOffsetY * 2
            );

            // Overlay ottimizzato (solo se globalAlpha è vicino a 1)
            if (globalAlpha > 0.8) {
              ctx.save();
              ctx.globalAlpha = globalAlpha * 0.7;
              ctx.filter = 'none'; // Rimuovi filtri per l'overlay
              ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
              ctx.fillRect(offsetX + trackOffsetX, offsetY + trackOffsetY, 250, 30);
              ctx.globalAlpha = globalAlpha;
              ctx.fillStyle = '#ffffff';
              ctx.font = '14px Arial';
              ctx.textAlign = 'left';
              const audioIcon = video.muted ? '🔇' : '🔊';
              const mediaOffset = item.mediaStartOffset || 0;
              const displayTime = relativeTime + mediaOffset;
              ctx.fillText(
                `${audioIcon} ${item.mediaFile.name} (${displayTime.toFixed(1)}s)`,
                offsetX + trackOffsetX + 10,
                offsetY + trackOffsetY + 20
              );
              ctx.restore();
            }
          }
        } else if (item.mediaFile.type === 'image') {
          const img = imageElementsRef.current.get(item.id);
          if (img && img.complete) {
            // Similar optimization for images...
            const imgAspect = img.width / img.height;
            const canvasAspect = canvas.width / canvas.height;

            let renderWidth, renderHeight, offsetX, offsetY;
            if (imgAspect > canvasAspect) {
              renderWidth = canvas.width * 0.8;
              renderHeight = renderWidth / imgAspect;
              offsetX = (canvas.width - renderWidth) / 2;
              offsetY = (canvas.height - renderHeight) / 2;
            } else {
              renderHeight = canvas.height * 0.8;
              renderWidth = renderHeight * imgAspect;
              offsetX = (canvas.width - renderWidth) / 2;
              offsetY = (canvas.height - renderHeight) / 2;
            }

            const trackOffsetX = item.track * 40;
            const trackOffsetY = item.track * 40;

            ctx.drawImage(
              img,
              offsetX + trackOffsetX,
              offsetY + trackOffsetY,
              renderWidth - trackOffsetX,
              renderHeight - trackOffsetY
            );
          }
        }
      } catch (error) {
        console.warn(`Error rendering item ${item.id}:`, error);
      }
    });

    // Ripristina il contesto dopo aver applicato gli effetti
    ctx.restore();

    // Renderizza gli indicatori degli effetti sopra tutto (solo per preview)
    renderEffectIndicators(ctx, canvas.width, canvas.height, activeEffects, currentTime);
  }, [activeItems, currentTime, canvasDimensions, calculateActiveEffects, calculateGlobalAlpha, isBlackWhiteActive, calculateZoomScale, calculateBlurIntensity, renderEffectIndicators]);

  // AGGIORNATO: Gestione elementi media migliorata - ora gestisce anche gli effetti
  useEffect(() => {
    const container = hiddenVideoContainerRef.current;
    if (!container) return;

    // Cleanup elementi non più necessari
    const currentItemIds = new Set(timelineItems.map(item => item.id));
    
    videoElementsRef.current.forEach((video, itemId) => {
      if (!currentItemIds.has(itemId)) {
        video.pause();
        video.remove();
        videoElementsRef.current.delete(itemId);
      }
    });

    audioElementsRef.current.forEach((audio, itemId) => {
      if (!currentItemIds.has(itemId)) {
        audio.pause();
        audio.remove();
        audioElementsRef.current.delete(itemId);
      }
    });

    imageElementsRef.current.forEach((img, itemId) => {
      if (!currentItemIds.has(itemId)) {
        imageElementsRef.current.delete(itemId);
      }
    });

    // Crea solo elementi nuovi (escludendo gli effetti che non hanno elementi media)
    timelineItems.forEach(item => {
      try {
        if (item.mediaFile.type === 'video' && !videoElementsRef.current.has(item.id)) {
          const video = document.createElement('video');
          video.src = item.mediaFile.url;
          video.crossOrigin = 'anonymous';
          video.muted = false;
          video.style.display = 'none';
          video.preload = 'metadata';
          
          // SICUREZZA: Imposta il volume solo dopo che l'elemento è pronto
          const setInitialVolume = () => {
            try {
              const itemVolume = trackVolumes.get(item.id) ?? 100;
              video.volume = Math.max(0, Math.min(1, (itemVolume / 100) * (volume / 100)));
            } catch (error) {
              console.warn(`Error setting initial video volume for ${item.id}:`, error);
            }
          };
          
          video.addEventListener('loadedmetadata', setInitialVolume);
          video.addEventListener('canplay', setInitialVolume);
          
          // OTTIMIZZAZIONE: Previeni eventi automatici
          video.addEventListener('timeupdate', (e) => e.stopPropagation());
          
          container.appendChild(video);
          videoElementsRef.current.set(item.id, video);
          
          // Imposta il volume immediatamente se possibile
          setInitialVolume();
        } else if (item.mediaFile.type === 'audio' && !audioElementsRef.current.has(item.id)) {
          const audio = document.createElement('audio');
          audio.src = item.mediaFile.url;
          audio.crossOrigin = 'anonymous';
          audio.muted = false;
          audio.preload = 'metadata';
          
          // SICUREZZA: Imposta il volume solo dopo che l'elemento è pronto
          const setInitialVolume = () => {
            try {
              const itemVolume = trackVolumes.get(item.id) ?? 100;
              audio.volume = Math.max(0, Math.min(1, (itemVolume / 100) * (volume / 100)));
            } catch (error) {
              console.warn(`Error setting initial audio volume for ${item.id}:`, error);
            }
          };
          
          audio.addEventListener('loadedmetadata', setInitialVolume);
          audio.addEventListener('canplay', setInitialVolume);
          audio.addEventListener('timeupdate', (e) => e.stopPropagation());
          
          container.appendChild(audio);
          audioElementsRef.current.set(item.id, audio);
          
          // Imposta il volume immediatamente se possibile
          setInitialVolume();
        } else if (item.mediaFile.type === 'image' && !imageElementsRef.current.has(item.id)) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = item.mediaFile.url;
          imageElementsRef.current.set(item.id, img);
        }
        // Gli effetti non creano elementi media, vengono gestiti direttamente nel rendering
      } catch (error) {
        console.error(`Error creating media element for ${item.id}:`, error);
      }
    });
  }, [timelineItems, volume, trackVolumes]);

  // OTTIMIZZAZIONE: Sincronizzazione media migliorata
  useEffect(() => {
    const syncTolerance = 0.1; // Ridotta la tolleranza per miglior precisione
    
    // Filtra solo gli elementi media attivi (escludendo gli effetti)
    const activeMediaItems = activeItems.filter(item => item.mediaFile.type !== 'effect');
    
    // Gestisci video
    videoElementsRef.current.forEach((video, itemId) => {
      try {
        const item = activeMediaItems.find(item => item.id === itemId);
        if (item && video && !video.error) {
          const relativeTime = currentTime - item.startTime;
          const mediaOffset = item.mediaStartOffset || 0;
          const targetTime = relativeTime + mediaOffset;

          // OTTIMIZZAZIONE: Sync solo quando necessario
          if (Math.abs(video.currentTime - targetTime) > syncTolerance) {
            video.currentTime = Math.max(0, targetTime);
          }

          if (isPlaying && targetTime >= 0 && targetTime <= video.duration && video.readyState >= 2) {
            try {
              const itemVolume = trackVolumes.get(itemId) ?? 100;
              video.volume = Math.max(0, Math.min(1, (itemVolume / 100) * (volume / 100)));
              if (video.paused) {
                video.play().catch(e => console.warn('Video play failed:', e));
              }
            } catch (volumeError) {
              console.warn(`Error setting video volume for ${itemId}:`, volumeError);
            }
          } else if (!video.paused) {
            video.pause();
          }
        } else if (video && !video.paused) {
          video.pause();
        }
      } catch (error) {
        console.warn(`Error handling video ${itemId}:`, error);
      }
    });

    // Gestisci audio
    audioElementsRef.current.forEach((audio, itemId) => {
      try {
        const item = activeMediaItems.find(item => item.id === itemId);
        if (item && audio && !audio.error) {
          const relativeTime = currentTime - item.startTime;
          const mediaOffset = item.mediaStartOffset || 0;
          const targetTime = relativeTime + mediaOffset;

          if (Math.abs(audio.currentTime - targetTime) > syncTolerance) {
            audio.currentTime = Math.max(0, targetTime);
          }

          if (isPlaying && targetTime >= 0 && targetTime <= audio.duration && audio.readyState >= 2) {
            try {
              const itemVolume = trackVolumes.get(itemId) ?? 100;
              audio.volume = Math.max(0, Math.min(1, (itemVolume / 100) * (volume / 100)));
              if (audio.paused) {
                audio.play().catch(e => console.warn('Audio play failed:', e));
              }
            } catch (volumeError) {
              console.warn(`Error setting audio volume for ${itemId}:`, volumeError);
            }
          } else if (!audio.paused) {
            audio.pause();
          }
        } else if (audio && !audio.paused) {
          audio.pause();
        }
      } catch (error) {
        console.warn(`Error handling audio ${itemId}:`, error);
      }
    });

    // Marca per re-render
    needsRenderRef.current = true;
  }, [isPlaying, activeItems, currentTime, volume, trackVolumes]);

  // OTTIMIZZAZIONE: Animation loop migliorato con timing reale
  useEffect(() => {
    if (isPlaying) {
      lastUpdateTimeRef.current = performance.now();
      
      const animate = () => {
        const now = performance.now();
        const deltaTime = (now - lastUpdateTimeRef.current) / 1000; // Convert to seconds
        lastUpdateTimeRef.current = now;
        
        const newTime = currentTime + deltaTime;
        onTimeUpdate(newTime);
        
        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, currentTime, onTimeUpdate]);

  // OTTIMIZZAZIONE: Rendering condizionale
  useEffect(() => {
    if (needsRenderRef.current) {
      renderComposite();
    }
  }, [renderComposite]);

  // Resta del codice per i controlli...
  const handlePlayPause = () => {
    onPlayStateChange(!isPlaying);
  };

  const handleSeekBackward = () => {
    const newTime = Math.max(0, currentTime - 5);
    onTimeUpdate(newTime);
    needsRenderRef.current = true;
  };

  const handleSeekForward = () => {
    const newTime = currentTime + 5;
    onTimeUpdate(newTime);
    needsRenderRef.current = true;
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    
    // SICUREZZA: Batch update del volume con controlli di sicurezza
    try {
      const volumeDecimal = newVolume / 100;
      videoElementsRef.current.forEach((video, itemId) => {
        try {
          if (video && !video.error && video.readyState > 0) {
            const itemVolume = trackVolumes.get(itemId) ?? 100;
            video.volume = Math.max(0, Math.min(1, (itemVolume / 100) * volumeDecimal));
          }
        } catch (error) {
          console.warn(`Error updating video volume for ${itemId}:`, error);
        }
      });
      
      audioElementsRef.current.forEach((audio, itemId) => {
        try {
          if (audio && !audio.error && audio.readyState > 0) {
            const itemVolume = trackVolumes.get(itemId) ?? 100;
            audio.volume = Math.max(0, Math.min(1, (itemVolume / 100) * volumeDecimal));
          }
        } catch (error) {
          console.warn(`Error updating audio volume for ${itemId}:`, error);
        }
      });
    } catch (error) {
      console.error('Error in handleVolumeChange:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col">
      <div ref={hiddenVideoContainerRef} style={{ display: 'none' }} />

      <div className="flex-1 flex items-center justify-center bg-black relative p-2 min-h-0">
        <canvas
          ref={canvasRef}
          width={canvasDimensions.width}
          height={canvasDimensions.height}
          className="w-full h-full object-contain border border-muted-foreground/20 bg-black"
          style={{
            aspectRatio: aspectRatio.replace(':', '/'),
            maxHeight: 'calc(100% - 20px)',
            maxWidth: 'calc(100% - 20px)'
          }}
        />
      </div>

      <Card className="m-2 p-3 bg-card/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSeekBackward}
              className="hover:bg-accent"
              disabled={timelineItems.length === 0}
            >
              <SkipBack className="w-4 h-4" />
            </Button>

            <Button
              onClick={handlePlayPause}
              size="lg"
              className="bg-gradient-primary hover:opacity-90"
              disabled={timelineItems.length === 0}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-1" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleSeekForward}
              className="hover:bg-accent"
              disabled={timelineItems.length === 0}
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <div className="text-sm text-muted-foreground font-mono">
            {formatTime(currentTime)}
            {timelineItems.length === 0 && (
              <span className="ml-2 text-xs opacity-60">
                (Add media to timeline)
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2 w-24">
            <Volume2 className="w-4 h-4 text-muted-foreground" />
            <Slider
              value={[volume]}
              onValueChange={handleVolumeChange}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-8">
              {volume}%
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
};
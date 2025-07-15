import { useRef, useEffect, useState, useCallback } from "react";
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
}

export const CompositeVideoPlayer = ({
  timelineItems,
  currentTime,
  isPlaying,
  onTimeUpdate,
  onPlayStateChange
}: CompositeVideoPlayerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVideoContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [volume, setVolume] = useState(100);
  const [userInteracted, setUserInteracted] = useState(false);
  const lastTimeRef = useRef(currentTime);
  const previousCurrentTimeRef = useRef(currentTime);

  // FIXED: Sincronizza lastTimeRef quando currentTime cambia dall'esterno (manual seek)
  useEffect(() => {
    if (Math.abs(currentTime - previousCurrentTimeRef.current) > 0.1) {
      // Se il currentTime è cambiato significativamente dall'esterno (non dall'animation loop)
      lastTimeRef.current = currentTime;
      previousCurrentTimeRef.current = currentTime;
      
      // Forza la sincronizzazione di tutti i media elements
      forceSyncAllMedia();
    } else {
      previousCurrentTimeRef.current = currentTime;
    }
  }, [currentTime]);

  // Trova tutti gli elementi attivi al tempo corrente
  const getActiveItems = useCallback(() => {
    return timelineItems.filter(item =>
      currentTime >= item.startTime &&
      currentTime < item.startTime + item.duration
    ).sort((a, b) => a.track - b.track); // Ordina per track (layer inferiore prima)
  }, [timelineItems, currentTime]);

  // FIXED: Funzione per forzare la sincronizzazione di tutti i media
  const forceSyncAllMedia = useCallback(() => {
    const activeItems = getActiveItems();

    // Sincronizza tutti i video
    videoElementsRef.current.forEach((video, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const actualVideoTime = relativeTime + mediaOffset;
        
        if (actualVideoTime >= 0 && actualVideoTime <= video.duration) {
          video.currentTime = actualVideoTime;
        }
      }
    });

    // Sincronizza tutti gli audio
    audioElementsRef.current.forEach((audio, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const actualAudioTime = relativeTime + mediaOffset;
        
        if (actualAudioTime >= 0 && actualAudioTime <= audio.duration) {
          audio.currentTime = actualAudioTime;
        }
      }
    });
  }, [currentTime, getActiveItems]);

  // Precarica e gestisce elementi media
  useEffect(() => {
    const container = hiddenVideoContainerRef.current;
    if (!container) return;

    timelineItems.forEach(item => {
      if (item.mediaFile.type === 'video' && item.mediaFile.url) {
        if (!videoElementsRef.current.has(item.id)) {
          const video = document.createElement('video');
          video.src = item.mediaFile.url;
          video.crossOrigin = 'anonymous';
          video.muted = !userInteracted; // Inizia muted per permettere autoplay
          video.volume = volume / 100;
          video.style.display = 'none';
          video.preload = 'metadata';

          // Aggiungi al DOM nascosto per permettere riproduzione audio
          container.appendChild(video);
          videoElementsRef.current.set(item.id, video);

          video.addEventListener('loadedmetadata', () => {
            console.log(`Video loaded: ${item.mediaFile.name}, duration: ${video.duration}`);
          });

          // FIXED: Previeni il seek automatico del video browser
          video.addEventListener('timeupdate', (e) => {
            e.stopPropagation();
          });
        }
      } else if (item.mediaFile.type === 'audio' && item.mediaFile.url) {
        if (!audioElementsRef.current.has(item.id)) {
          const audio = document.createElement('audio');
          audio.src = item.mediaFile.url;
          audio.crossOrigin = 'anonymous';
          audio.muted = !userInteracted;
          audio.volume = volume / 100;
          audio.preload = 'metadata';

          // Aggiungi al DOM nascosto
          container.appendChild(audio);
          audioElementsRef.current.set(item.id, audio);

          audio.addEventListener('loadedmetadata', () => {
            console.log(`Audio loaded: ${item.mediaFile.name}, duration: ${audio.duration}`);
          });

          // FIXED: Previeni il seek automatico dell'audio browser
          audio.addEventListener('timeupdate', (e) => {
            e.stopPropagation();
          });
        }
      } else if (item.mediaFile.type === 'image' && item.mediaFile.url) {
        if (!imageElementsRef.current.has(item.id)) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = item.mediaFile.url;
          imageElementsRef.current.set(item.id, img);
        }
      }
    });
  }, [timelineItems, volume, userInteracted]);

  // Gestisci il play/pause e la sincronizzazione dei media
  useEffect(() => {
    const activeItems = getActiveItems();

    // Gestisci i video
    videoElementsRef.current.forEach((video, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const actualVideoTime = relativeTime + mediaOffset;

        // FIXED: Sincronizza sempre il tempo, ma con tolleranza ridotta per evitare loop
        if (Math.abs(video.currentTime - actualVideoTime) > 0.2) {
          video.currentTime = actualVideoTime;
        }

        if (isPlaying && userInteracted && actualVideoTime >= 0 && actualVideoTime <= video.duration) {
          video.muted = false;
          video.volume = volume / 100;
          video.play().catch(e => {
            console.warn('Video play failed:', e);
            // Fallback: prova a riprodurre muted
            video.muted = true;
            video.play().catch(err => console.warn('Muted video play failed:', err));
          });
        } else {
          video.pause();
        }
      } else {
        video.pause();
      }
    });

    // Gestisci gli audio
    audioElementsRef.current.forEach((audio, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const actualAudioTime = relativeTime + mediaOffset;

        // FIXED: Sincronizza sempre il tempo, ma con tolleranza ridotta per evitare loop
        if (Math.abs(audio.currentTime - actualAudioTime) > 0.2) {
          audio.currentTime = actualAudioTime;
        }

        if (isPlaying && userInteracted && actualAudioTime >= 0 && actualAudioTime <= audio.duration) {
          audio.muted = false;
          audio.volume = volume / 100;
          audio.play().catch(e => {
            console.warn('Audio play failed:', e);
          });
        } else {
          audio.pause();
        }
      } else {
        audio.pause();
      }
    });
  }, [isPlaying, getActiveItems, currentTime, volume, userInteracted]);

  // Rendering composito su canvas
  const renderComposite = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const activeItems = getActiveItems();

    // Pulisci canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (activeItems.length === 0) {
      // Mostra messaggio con icona ciak quando non ci sono elementi attivi
      ctx.fillStyle = '#666666';
      ctx.font = '64px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🎬', canvas.width / 2, canvas.height / 2 - 40);
      ctx.font = '24px Arial';
      ctx.fillText('No active media at current time', canvas.width / 2, canvas.height / 2 + 20);
      ctx.font = '16px Arial';
      ctx.fillText('Add media to timeline and play to see preview', canvas.width / 2, canvas.height / 2 + 50);
      return;
    }

    // Renderizza ogni elemento attivo (dal track più basso al più alto)
    activeItems.forEach(item => {
      const relativeTime = currentTime - item.startTime;

      try {
        if (item.mediaFile.type === 'video') {
          const video = videoElementsRef.current.get(item.id);
          if (video && video.readyState >= 2) { // HAVE_CURRENT_DATA
            // Calcola dimensioni mantenendo aspect ratio
            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = canvas.width / canvas.height;

            let renderWidth, renderHeight, offsetX, offsetY;

            if (videoAspect > canvasAspect) {
              // Video più largo del canvas
              renderWidth = canvas.width;
              renderHeight = canvas.width / videoAspect;
              offsetX = 0;
              offsetY = (canvas.height - renderHeight) / 2;
            } else {
              // Video più alto del canvas
              renderWidth = canvas.height * videoAspect;
              renderHeight = canvas.height;
              offsetX = (canvas.width - renderWidth) / 2;
              offsetY = 0;
            }

            // Applica offset basato su track per layering
            const trackOffsetX = item.track * 20;
            const trackOffsetY = item.track * 20;

            ctx.drawImage(
              video,
              offsetX + trackOffsetX,
              offsetY + trackOffsetY,
              renderWidth - trackOffsetX * 2,
              renderHeight - trackOffsetY * 2
            );

            // Overlay con nome del file e info audio
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(offsetX + trackOffsetX, offsetY + trackOffsetY, 250, 30);
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
          } else {
            // Placeholder per video non ancora caricato
            const trackColor = `hsl(${item.track * 120}, 60%, 40%)`;
            ctx.fillStyle = trackColor;
            ctx.fillRect(
              item.track * 30,
              item.track * 30,
              canvas.width - item.track * 60,
              canvas.height - item.track * 60
            );
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(
              `Loading: ${item.mediaFile.name}`,
              item.track * 30 + 20,
              item.track * 30 + 40
            );
          }
        } else if (item.mediaFile.type === 'image') {
          const img = imageElementsRef.current.get(item.id);
          if (img && img.complete) {
            // Calcola dimensioni per immagine
            const imgAspect = img.width / img.height;
            const canvasAspect = canvas.width / canvas.height;

            let renderWidth, renderHeight, offsetX, offsetY;

            if (imgAspect > canvasAspect) {
              renderWidth = canvas.width * 0.8; // Leggermente più piccola per le immagini
              renderHeight = renderWidth / imgAspect;
              offsetX = (canvas.width - renderWidth) / 2;
              offsetY = (canvas.height - renderHeight) / 2;
            } else {
              renderHeight = canvas.height * 0.8;
              renderWidth = renderHeight * imgAspect;
              offsetX = (canvas.width - renderWidth) / 2;
              offsetY = (canvas.height - renderHeight) / 2;
            }

            // Offset per track
            const trackOffsetX = item.track * 40;
            const trackOffsetY = item.track * 40;

            ctx.drawImage(
              img,
              offsetX + trackOffsetX,
              offsetY + trackOffsetY,
              renderWidth - trackOffsetX,
              renderHeight - trackOffsetY
            );

            // Overlay
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(offsetX + trackOffsetX, offsetY + trackOffsetY, 180, 25);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.fillText(
              item.mediaFile.name,
              offsetX + trackOffsetX + 10,
              offsetY + trackOffsetY + 18
            );
          } else {
            // Placeholder per immagine non caricata
            const trackColor = `hsl(${item.track * 120 + 60}, 70%, 60%)`;
            ctx.fillStyle = trackColor;
            ctx.fillRect(
              item.track * 40,
              item.track * 40,
              300,
              200
            );
            ctx.fillStyle = '#000000';
            ctx.font = '14px Arial';
            ctx.fillText(
              `Loading: ${item.mediaFile.name}`,
              item.track * 40 + 20,
              item.track * 40 + 30
            );
          }
        } else if (item.mediaFile.type === 'audio') {
          // Visualizzazione per file audio - con indicatori di riproduzione
          const audio = audioElementsRef.current.get(item.id);
          const isAudioPlaying = audio && !audio.paused;
          const trackColor = isAudioPlaying ? `hsl(${item.track * 120 + 180}, 90%, 60%)` : `hsl(${item.track * 120 + 180}, 70%, 50%)`;

          ctx.fillStyle = trackColor;
          ctx.fillRect(
            20,
            canvas.height - 60 - item.track * 25,
            200,
            20
          );
          ctx.fillStyle = '#ffffff';
          ctx.font = '12px Arial';
          const audioIcon = (audio && audio.muted) ? '🔇' : (isAudioPlaying ? '🎵' : '♪');
          const mediaOffset = item.mediaStartOffset || 0;
          const displayTime = relativeTime + mediaOffset;
          ctx.fillText(
            `${audioIcon} ${item.mediaFile.name} (${displayTime.toFixed(1)}s)`,
            30,
            canvas.height - 48 - item.track * 25
          );
        }
      } catch (error) {
        console.warn(`Error rendering item ${item.id}:`, error);
      }
    });

    // HUD con informazioni
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(10, 10, 350, 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Time: ${currentTime.toFixed(1)}s`, 20, 30);
    ctx.font = '12px Arial';
    ctx.fillText(`Active Items: ${activeItems.length}`, 20, 50);
    ctx.fillText(`Total Timeline Items: ${timelineItems.length}`, 20, 65);
    if (!userInteracted) {
      ctx.fillStyle = '#ffaa00';
      ctx.fillText(`⚠️ Click to enable audio`, 20, 80);
    } else {
      ctx.fillStyle = '#00ff00';
      ctx.fillText(`🔊 Audio enabled`, 20, 80);
    }

  }, [currentTime, timelineItems, getActiveItems, userInteracted]);

  // FIXED: Animation loop migliorato per il playback - usa sempre lastTimeRef come riferimento
  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        const deltaTime = 0.033; // ~30fps
        const newTime = lastTimeRef.current + deltaTime;
        lastTimeRef.current = newTime;
        onTimeUpdate(newTime);
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      
      // FIXED: Assicurati che lastTimeRef sia sincronizzato prima di iniziare l'animazione
      lastTimeRef.current = currentTime;
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
  }, [isPlaying, onTimeUpdate]);

  // Re-render quando cambiano tempo o elementi timeline
  useEffect(() => {
    renderComposite();
  }, [renderComposite]);

  const handlePlayPause = () => {
    // Abilita l'interazione utente per sbloccare l'audio
    if (!userInteracted) {
      setUserInteracted(true);
    }
    
    // FIXED: Quando si preme play, assicurati che lastTimeRef sia sincronizzato con currentTime
    if (!isPlaying) {
      lastTimeRef.current = currentTime;
    }
    
    onPlayStateChange(!isPlaying);
  };

  const handleSeekBackward = () => {
    const newTime = Math.max(0, currentTime - 5);
    onTimeUpdate(newTime);
    // lastTimeRef verrà aggiornato dal useEffect che monitora currentTime
  };

  const handleSeekForward = () => {
    const newTime = currentTime + 5;
    onTimeUpdate(newTime);
    // lastTimeRef verrà aggiornato dal useEffect che monitora currentTime
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    // Applica volume a tutti i video e audio attivi
    videoElementsRef.current.forEach(video => {
      video.volume = newVolume / 100;
    });
    audioElementsRef.current.forEach(audio => {
      audio.volume = newVolume / 100;
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Hidden container per video/audio elements */}
      <div ref={hiddenVideoContainerRef} style={{ display: 'none' }} />

      {/* Video Display Area - Canvas per composizione */}
      <div className="flex-1 flex items-center justify-center bg-black relative p-2 min-h-0">
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          className="w-full h-full object-contain border border-muted-foreground/20 bg-black"
          style={{ 
            aspectRatio: '16/9',
            maxHeight: 'calc(100% - 20px)', // Lascia spazio per il padding
            maxWidth: 'calc(100% - 20px)'
          }}
          onClick={() => {
            if (!userInteracted) {
              setUserInteracted(true);
            }
          }}
        />

        {/* Overlay Play Button - Central */}
        {!isPlaying && (
          <Button
            onClick={handlePlayPause}
            size="lg"
            className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-black/70 hover:bg-black/80 border-2 border-white/30 backdrop-blur-sm transition-all duration-200 hover:scale-110"
            disabled={timelineItems.length === 0}
          >
            <Play className="w-8 h-8 text-white ml-1" />
          </Button>
        )}

        {/* Pause overlay quando in riproduzione */}
        {isPlaying && (
          <div
            className="absolute inset-0 cursor-pointer group"
            onClick={handlePlayPause}
          >
            <Button
              onClick={handlePlayPause}
              size="lg"
              className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-black/50 hover:bg-black/70 border-2 border-white/20 backdrop-blur-sm transition-all duration-200 opacity-0 group-hover:opacity-100"
            >
              <Pause className="w-8 h-8 text-white" />
            </Button>
          </div>
        )}

        {/* Audio Warning */}
        {!userInteracted && (
          <div className="absolute bottom-2 left-2 bg-yellow-600/90 text-white px-2 py-1 rounded-md text-xs backdrop-blur-sm">
            ⚠️ Click to enable audio
          </div>
        )}
      </div>

      {/* Controls - Always visible */}
      <Card className="m-2 p-3 bg-card/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between">
          {/* Playback Controls */}
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

          {/* Time Display */}
          <div className="text-sm text-muted-foreground font-mono">
            {formatTime(currentTime)}
            {timelineItems.length === 0 && (
              <span className="ml-2 text-xs opacity-60">
                (Add media to timeline)
              </span>
            )}
          </div>

          {/* Volume Control */}
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
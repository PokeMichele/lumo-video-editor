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
  totalDuration: number;
}

export const CompositeVideoPlayer = ({
  timelineItems,
  currentTime,
  isPlaying,
  onTimeUpdate,
  onPlayStateChange,
  totalDuration
}: CompositeVideoPlayerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [volume, setVolume] = useState(100);
  const [isSeeking, setIsSeeking] = useState(false);
  const lastUpdateTimeRef = useRef(0);

  // Trova tutti gli elementi attivi al tempo corrente
  const getActiveItems = useCallback(() => {
    return timelineItems.filter(item =>
      currentTime >= item.startTime &&
      currentTime < item.startTime + item.duration
    ).sort((a, b) => a.track - b.track); // Ordina per track (layer inferiore prima)
  }, [timelineItems, currentTime]);

  // Precarica e gestisce elementi media
  useEffect(() => {
    timelineItems.forEach(item => {
      if (item.mediaFile.type === 'video' && item.mediaFile.url) {
        if (!videoElementsRef.current.has(item.id)) {
          const video = document.createElement('video');
          video.src = item.mediaFile.url;
          video.crossOrigin = 'anonymous';
          video.muted = false; // IMPORTANTE: Non muto per sentire l'audio
          video.volume = volume / 100;
          video.preload = 'metadata';
          video.load();
          videoElementsRef.current.set(item.id, video);
        }
      } else if (item.mediaFile.type === 'audio' && item.mediaFile.url) {
        if (!audioElementsRef.current.has(item.id)) {
          const audio = document.createElement('audio');
          audio.src = item.mediaFile.url;
          audio.crossOrigin = 'anonymous';
          audio.volume = volume / 100;
          audio.preload = 'metadata';
          audio.load();
          audioElementsRef.current.set(item.id, audio);
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

    // Cleanup elements that are no longer in timeline
    const currentItemIds = new Set(timelineItems.map(item => item.id));

    videoElementsRef.current.forEach((video, id) => {
      if (!currentItemIds.has(id)) {
        video.pause();
        video.src = '';
        videoElementsRef.current.delete(id);
      }
    });

    audioElementsRef.current.forEach((audio, id) => {
      if (!currentItemIds.has(id)) {
        audio.pause();
        audio.src = '';
        audioElementsRef.current.delete(id);
      }
    });

    imageElementsRef.current.forEach((img, id) => {
      if (!currentItemIds.has(id)) {
        imageElementsRef.current.delete(id);
      }
    });
  }, [timelineItems, volume]);

  // Sincronizza media con tempo corrente
  const syncMediaElements = useCallback(() => {
    const activeItems = getActiveItems();
    const tolerance = 0.2; // Tolleranza di sincronizzazione in secondi

    // Gestisci video
    videoElementsRef.current.forEach((video, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;

        // Sincronizza solo se necessario per evitare interruzioni audio
        if (Math.abs(video.currentTime - relativeTime) > tolerance && !isSeeking) {
          video.currentTime = relativeTime;
        }

        if (isPlaying && video.paused) {
          video.play().catch(e => console.warn('Video play failed:', e));
        } else if (!isPlaying && !video.paused) {
          video.pause();
        }
      } else {
        // Video non attivo
        if (!video.paused) {
          video.pause();
        }
      }
    });

    // Gestisci audio
    audioElementsRef.current.forEach((audio, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;

        // Sincronizza solo se necessario
        if (Math.abs(audio.currentTime - relativeTime) > tolerance && !isSeeking) {
          audio.currentTime = relativeTime;
        }

        if (isPlaying && audio.paused) {
          audio.play().catch(e => console.warn('Audio play failed:', e));
        } else if (!isPlaying && !audio.paused) {
          audio.pause();
        }
      } else {
        // Audio non attivo
        if (!audio.paused) {
          audio.pause();
        }
      }
    });
  }, [currentTime, isPlaying, getActiveItems, isSeeking]);

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

            // Solo il video track ha un offset speciale per layering
            if (item.track > 0) {
              const trackOffsetX = item.track * 30;
              const trackOffsetY = item.track * 30;
              renderWidth *= 0.8;
              renderHeight *= 0.8;
              offsetX += trackOffsetX;
              offsetY += trackOffsetY;
            }

            ctx.drawImage(video, offsetX, offsetY, renderWidth, renderHeight);

            // Overlay con nome del file
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(offsetX, offsetY, 200, 30);
            ctx.fillStyle = '#ffffff';
            ctx.font = '14px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(
              `${item.mediaFile.name} (${relativeTime.toFixed(1)}s)`,
              offsetX + 10,
              offsetY + 20
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

            ctx.drawImage(img, offsetX, offsetY, renderWidth, renderHeight);

            // Overlay
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(offsetX, offsetY, 180, 25);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.fillText(item.mediaFile.name, offsetX + 10, offsetY + 18);
          }
        } else if (item.mediaFile.type === 'audio') {
          // Visualizzazione per file audio con waveform simulata
          const barCount = 50;
          const barWidth = 4;
          const barSpacing = 2;
          const baseY = canvas.height - 80 - item.track * 30;

          ctx.fillStyle = `hsl(${item.track * 120 + 180}, 70%, 50%)`;

          for (let i = 0; i < barCount; i++) {
            // Simula una waveform basata sul tempo
            const phase = (relativeTime * 10 + i * 0.5) % (Math.PI * 2);
            const height = 15 + Math.sin(phase) * 8;
            const x = 50 + i * (barWidth + barSpacing);

            ctx.fillRect(x, baseY - height, barWidth, height);
          }

          ctx.fillStyle = '#ffffff';
          ctx.font = '12px Arial';
          ctx.fillText(
            `♪ ${item.mediaFile.name} (${relativeTime.toFixed(1)}s)`,
            50,
            baseY - 20
          );
        }
      } catch (error) {
        console.warn(`Error rendering item ${item.id}:`, error);
      }
    });

    // HUD con informazioni
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(10, 10, 300, 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Time: ${currentTime.toFixed(1)}s / ${totalDuration.toFixed(1)}s`, 20, 30);
    ctx.font = '12px Arial';
    ctx.fillText(`Active Items: ${activeItems.length}`, 20, 50);
    ctx.fillText(`Total Timeline Items: ${timelineItems.length}`, 20, 65);
    ctx.fillText(`Volume: ${volume}%`, 20, 80);

  }, [currentTime, timelineItems, getActiveItems, totalDuration, volume]);

  // Animation loop per il playback
  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        const now = performance.now();
        if (now - lastUpdateTimeRef.current >= 33) { // ~30fps
          onTimeUpdate(prevTime => {
            const newTime = prevTime + 0.033;
            return Math.min(newTime, totalDuration);
          });
          lastUpdateTimeRef.current = now;
        }
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
  }, [isPlaying, onTimeUpdate, totalDuration]);

  // Sincronizza media elements quando cambia il tempo o lo stato di play
  useEffect(() => {
    syncMediaElements();
  }, [syncMediaElements]);

  // Re-render quando necessario
  useEffect(() => {
    renderComposite();
  }, [renderComposite]);

  // Gestisci il volume change
  useEffect(() => {
    videoElementsRef.current.forEach(video => {
      video.volume = volume / 100;
    });
    audioElementsRef.current.forEach(audio => {
      audio.volume = volume / 100;
    });
  }, [volume]);

  const handlePlayPause = () => {
    onPlayStateChange(!isPlaying);
  };

  const handleSeekBackward = () => {
    setIsSeeking(true);
    onTimeUpdate(Math.max(0, currentTime - 5));
    setTimeout(() => setIsSeeking(false), 100);
  };

  const handleSeekForward = () => {
    setIsSeeking(true);
    onTimeUpdate(Math.min(totalDuration, currentTime + 5));
    setTimeout(() => setIsSeeking(false), 100);
  };

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0]);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Video Display Area - Canvas per composizione */}
      <div className="flex-1 flex items-center justify-center bg-black relative p-4">
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          className="max-w-full max-h-full border border-muted-foreground/20 bg-black"
          style={{ aspectRatio: '16/9' }}
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
      </div>

      {/* Controls - Always visible */}
      <Card className="m-4 p-4 bg-card/95 backdrop-blur-sm">
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
            {formatTime(currentTime)} / {formatTime(totalDuration)}
            {timelineItems.length === 0 && (
              <span className="ml-2 text-xs opacity-60">
                (Add media to timeline)
              </span>
            )}
          </div>

          {/* Volume Control */}
          <div className="flex items-center space-x-2 w-32">
            <Volume2 className="w-4 h-4 text-muted-foreground" />
            <Slider
              value={[volume]}
              onValueChange={handleVolumeChange}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-8">{volume}%</span>
          </div>
        </div>
      </Card>
    </div>
  );
};

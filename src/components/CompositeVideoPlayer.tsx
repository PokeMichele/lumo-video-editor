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
}

export const CompositeVideoPlayer = ({
  timelineItems,
  currentTime,
  isPlaying,
  onTimeUpdate,
  onPlayStateChange,
  aspectRatio
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

    // OTTIMIZZAZIONE: Batch rendering degli elementi attivi
    activeItems.forEach(item => {
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

            // Overlay ottimizzato
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
  }, [activeItems, currentTime, canvasDimensions]);

  // OTTIMIZZAZIONE: Miglior gestione elementi media
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

    // Crea solo elementi nuovi
    timelineItems.forEach(item => {
      if (item.mediaFile.type === 'video' && !videoElementsRef.current.has(item.id)) {
        const video = document.createElement('video');
        video.src = item.mediaFile.url;
        video.crossOrigin = 'anonymous';
        video.muted = false;
        video.volume = volume / 100;
        video.style.display = 'none';
        video.preload = 'metadata';
        
        // OTTIMIZZAZIONE: Previeni eventi automatici
        video.addEventListener('timeupdate', (e) => e.stopPropagation());
        
        container.appendChild(video);
        videoElementsRef.current.set(item.id, video);
      } else if (item.mediaFile.type === 'audio' && !audioElementsRef.current.has(item.id)) {
        const audio = document.createElement('audio');
        audio.src = item.mediaFile.url;
        audio.crossOrigin = 'anonymous';
        audio.muted = false;
        audio.volume = volume / 100;
        audio.preload = 'metadata';
        
        audio.addEventListener('timeupdate', (e) => e.stopPropagation());
        
        container.appendChild(audio);
        audioElementsRef.current.set(item.id, audio);
      } else if (item.mediaFile.type === 'image' && !imageElementsRef.current.has(item.id)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = item.mediaFile.url;
        imageElementsRef.current.set(item.id, img);
      }
    });
  }, [timelineItems, volume]);

  // OTTIMIZZAZIONE: Sincronizzazione media migliorata
  useEffect(() => {
    const syncTolerance = 0.1; // Ridotta la tolleranza per miglior precisione
    
    // Gestisci video
    videoElementsRef.current.forEach((video, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const targetTime = relativeTime + mediaOffset;

        // OTTIMIZZAZIONE: Sync solo quando necessario
        if (Math.abs(video.currentTime - targetTime) > syncTolerance) {
          video.currentTime = targetTime;
        }

        if (isPlaying && targetTime >= 0 && targetTime <= video.duration) {
          video.volume = volume / 100;
          if (video.paused) {
            video.play().catch(e => console.warn('Video play failed:', e));
          }
        } else if (!video.paused) {
          video.pause();
        }
      } else if (!video.paused) {
        video.pause();
      }
    });

    // Gestisci audio
    audioElementsRef.current.forEach((audio, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = currentTime - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const targetTime = relativeTime + mediaOffset;

        if (Math.abs(audio.currentTime - targetTime) > syncTolerance) {
          audio.currentTime = targetTime;
        }

        if (isPlaying && targetTime >= 0 && targetTime <= audio.duration) {
          audio.volume = volume / 100;
          if (audio.paused) {
            audio.play().catch(e => console.warn('Audio play failed:', e));
          }
        } else if (!audio.paused) {
          audio.pause();
        }
      } else if (!audio.paused) {
        audio.pause();
      }
    });

    // Marca per re-render
    needsRenderRef.current = true;
  }, [isPlaying, activeItems, currentTime, volume]);

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
    
    // OTTIMIZZAZIONE: Batch update del volume
    const volumeDecimal = newVolume / 100;
    videoElementsRef.current.forEach(video => {
      video.volume = volumeDecimal;
    });
    audioElementsRef.current.forEach(audio => {
      audio.volume = volumeDecimal;
    });
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
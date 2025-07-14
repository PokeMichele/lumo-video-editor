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
  const animationFrameRef = useRef<number | null>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imageElementsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [volume, setVolume] = useState(100);
  const lastTimeRef = useRef(currentTime);

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
          video.load();
          videoElementsRef.current.set(item.id, video);
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
  }, [timelineItems]);

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
      // Mostra messaggio quando non ci sono elementi attivi
      ctx.fillStyle = '#666666';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No active media at current time', canvas.width / 2, canvas.height / 2);
      ctx.font = '16px Arial';
      ctx.fillText('Add media to timeline and play to see preview', canvas.width / 2, canvas.height / 2 + 40);
      return;
    }

    // Renderizza ogni elemento attivo (dal track più basso al più alto)
    activeItems.forEach(item => {
      const relativeTime = currentTime - item.startTime;

      try {
        if (item.mediaFile.type === 'video') {
          const video = videoElementsRef.current.get(item.id);
          if (video && video.readyState >= 2) { // HAVE_CURRENT_DATA
            // Sincronizza il tempo del video
            if (Math.abs(video.currentTime - relativeTime) > 0.1) {
              video.currentTime = relativeTime;
            }

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

            // Overlay con nome del file
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(offsetX + trackOffsetX, offsetY + trackOffsetY, 200, 30);
            ctx.fillStyle = '#ffffff';
            ctx.font = '14px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(
              `${item.mediaFile.name} (${relativeTime.toFixed(1)}s)`,
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
          // Visualizzazione per file audio
          const trackColor = `hsl(${item.track * 120 + 180}, 70%, 50%)`;
          ctx.fillStyle = trackColor;
          ctx.fillRect(
            20,
            canvas.height - 60 - item.track * 25,
            200,
            20
          );
          ctx.fillStyle = '#ffffff';
          ctx.font = '12px Arial';
          ctx.fillText(
            `♪ ${item.mediaFile.name}`,
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
    ctx.fillRect(10, 10, 300, 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Time: ${currentTime.toFixed(1)}s`, 20, 30);
    ctx.font = '12px Arial';
    ctx.fillText(`Active Items: ${activeItems.length}`, 20, 50);
    ctx.fillText(`Total Timeline Items: ${timelineItems.length}`, 20, 65);

  }, [currentTime, timelineItems, getActiveItems]);

  // Animation loop per il playback
  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        const deltaTime = 0.033; // ~30fps
        onTimeUpdate((prevTime) => {
          const newTime = prevTime + deltaTime;
          lastTimeRef.current = newTime;
          return newTime;
        });
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
  }, [isPlaying, onTimeUpdate]);

  // Re-render quando cambiano tempo o elementi timeline
  useEffect(() => {
    renderComposite();
  }, [renderComposite]);

  // Gestisci il play/pause dei video
  useEffect(() => {
    const activeItems = getActiveItems();
    videoElementsRef.current.forEach((video, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item && isPlaying) {
        video.play().catch(e => console.warn('Video play failed:', e));
      } else {
        video.pause();
      }
    });
  }, [isPlaying, getActiveItems]);

  const handlePlayPause = () => {
    onPlayStateChange(!isPlaying);
  };

  const handleSeekBackward = () => {
    onTimeUpdate(Math.max(0, currentTime - 5));
  };

  const handleSeekForward = () => {
    onTimeUpdate(currentTime + 5);
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    // Applica volume a tutti i video attivi
    videoElementsRef.current.forEach(video => {
      video.volume = newVolume / 100;
    });
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
      </div>

      {/* Controls */}
      <Card className="m-4 p-4 bg-card/95 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {/* Playback Controls */}
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSeekBackward}
              className="hover:bg-accent"
            >
              <SkipBack className="w-4 h-4" />
            </Button>

            <Button
              onClick={handlePlayPause}
              size="lg"
              className="bg-gradient-primary hover:opacity-90"
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
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          {/* Time Display */}
          <div className="text-sm text-muted-foreground font-mono">
            {formatTime(currentTime)}
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
          </div>
        </div>
      </Card>
    </div>
  );
};

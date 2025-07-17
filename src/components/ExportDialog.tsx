import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle, X } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  totalDuration: number;
  aspectRatio: '16:9' | '4:3' | '9:16';
}

export const ExportDialog = ({ 
  isOpen, 
  onClose, 
  timelineItems, 
  totalDuration, 
  aspectRatio 
}: ExportDialogProps) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'preparing' | 'rendering' | 'completed' | 'error'>('preparing');
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Calculate canvas dimensions based on aspect ratio
  const getCanvasDimensions = () => {
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
  };

  // Create audio elements for timeline items
  const createAudioElements = async () => {
    const audioElements: Map<string, HTMLAudioElement | HTMLVideoElement> = new Map();
    
    for (const item of timelineItems) {
      if (item.mediaFile.type === 'video' || item.mediaFile.type === 'audio') {
        const element = item.mediaFile.type === 'video' 
          ? document.createElement('video') 
          : document.createElement('audio');
        
        element.src = item.mediaFile.url;
        element.crossOrigin = 'anonymous';
        element.muted = false;
        element.volume = 1.0;
        element.preload = 'metadata';
        
        await new Promise<void>((resolve) => {
          element.addEventListener('loadedmetadata', () => resolve());
          element.addEventListener('error', () => resolve());
          setTimeout(() => resolve(), 1000); // Fallback timeout
        });
        
        audioElements.set(item.id, element);
      }
    }
    
    return audioElements;
  };

  // Mix audio at specific time
  const mixAudioAtTime = (time: number, audioElements: Map<string, HTMLAudioElement | HTMLVideoElement>, audioContext: AudioContext) => {
    const activeItems = timelineItems.filter(item =>
      time >= item.startTime && time < item.startTime + item.duration
    );

    // Set audio element times and play states
    audioElements.forEach((element, itemId) => {
      const item = activeItems.find(item => item.id === itemId);
      if (item) {
        const relativeTime = time - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const actualTime = relativeTime + mediaOffset;

        if (actualTime >= 0 && actualTime <= element.duration) {
          element.currentTime = actualTime;
          if (element.paused) {
            element.play().catch(() => {});
          }
        } else {
          element.pause();
        }
      } else {
        element.pause();
      }
    });
  };

  // Render frame at specific time
  const renderFrame = async (time: number, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get active items at this time
    const activeItems = timelineItems.filter(item =>
      time >= item.startTime && time < item.startTime + item.duration
    ).sort((a, b) => a.track - b.track);

    // Render each active item
    for (const item of activeItems) {
      const relativeTime = time - item.startTime;
      const mediaOffset = item.mediaStartOffset || 0;
      const actualTime = relativeTime + mediaOffset;

      if (item.mediaFile.type === 'video') {
        const video = document.createElement('video');
        video.src = item.mediaFile.url;
        video.currentTime = actualTime;
        video.muted = true;
        
        await new Promise<void>((resolve) => {
          video.addEventListener('loadeddata', () => {
            if (video.readyState >= 2) {
              try {
                // Calculate dimensions maintaining aspect ratio
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

                // Apply track offset
                const trackOffsetX = item.track * 20;
                const trackOffsetY = item.track * 20;

                ctx.drawImage(
                  video,
                  offsetX + trackOffsetX,
                  offsetY + trackOffsetY,
                  renderWidth - trackOffsetX * 2,
                  renderHeight - trackOffsetY * 2
                );
              } catch (error) {
                console.warn('Error drawing video frame:', error);
              }
            }
            resolve();
          });
          
          video.addEventListener('error', () => resolve());
          setTimeout(() => resolve(), 100); // Fallback timeout
        });
      } else if (item.mediaFile.type === 'image') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = item.mediaFile.url;
        
        await new Promise<void>((resolve) => {
          img.onload = () => {
            try {
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
            } catch (error) {
              console.warn('Error drawing image frame:', error);
            }
            resolve();
          };
          
          img.onerror = () => resolve();
          setTimeout(() => resolve(), 100); // Fallback timeout
        });
      }
    }
  };

  // Export process
  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setStatus('preparing');
      setExportedVideoUrl(null);
      recordedChunksRef.current = [];
      return;
    }

    const exportVideo = async () => {
      try {
        setStatus('preparing');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not available');
        
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context not available');
        
        const dimensions = getCanvasDimensions();
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        
        // Create audio context for mixing
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;
        
        // Create audio elements
        const audioElements = await createAudioElements();
        
        setStatus('rendering');
        
        // Create audio destination for mixing
        const audioDestination = audioContext.createMediaStreamDestination();
        
        // Connect audio elements to destination
        audioElements.forEach((element) => {
          try {
            const source = audioContext.createMediaElementSource(element);
            source.connect(audioDestination);
          } catch (error) {
            console.warn('Error connecting audio source:', error);
          }
        });
        
        // Combine canvas stream with audio
        const canvasStream = canvas.captureStream(30); // 30 FPS
        const audioStream = audioDestination.stream;
        
        // Create combined stream
        const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
        ]);
        
        // Set up MediaRecorder with combined stream
        const mediaRecorder = new MediaRecorder(combinedStream, {
          mimeType: 'video/webm;codecs=vp9,opus'
        });
        
        mediaRecorderRef.current = mediaRecorder;
        recordedChunksRef.current = [];
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          setExportedVideoUrl(url);
          setStatus('completed');
          
          // Clean up audio elements
          audioElements.forEach(element => {
            element.pause();
            element.remove();
          });
          
          // Clean up audio context
          if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
          }
          
          // Auto-download
          const link = document.createElement('a');
          link.href = url;
          link.download = `exported-video-${aspectRatio}-${Date.now()}.webm`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        };
        
        mediaRecorder.start();
        
        // Calculate actual export duration
        const maxEndTime = timelineItems.reduce((max, item) => {
          return Math.max(max, item.startTime + item.duration);
        }, 0);
        
        const exportDuration = Math.max(maxEndTime, 1);
        const fps = 30;
        const totalFrames = Math.ceil(exportDuration * fps);
        const frameInterval = 1000 / fps;
        
        let currentFrame = 0;
        
        const renderNextFrame = async () => {
          if (currentFrame >= totalFrames) {
            mediaRecorder.stop();
            return;
          }
          
          const currentTime = currentFrame / fps;
          
          // Mix audio at current time
          mixAudioAtTime(currentTime, audioElements, audioContext);
          
          // Render video frame
          await renderFrame(currentTime, ctx, canvas);
          
          currentFrame++;
          const progressPercent = (currentFrame / totalFrames) * 100;
          setProgress(progressPercent);
          
          setTimeout(renderNextFrame, frameInterval);
        };
        
        renderNextFrame();
        
      } catch (error) {
        console.error('Export failed:', error);
        setStatus('error');
      }
    };

    exportVideo();
  }, [isOpen, timelineItems, aspectRatio]);

  const handleClose = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (exportedVideoUrl) {
      URL.revokeObjectURL(exportedVideoUrl);
    }
    onClose();
  };

  const getStatusText = () => {
    switch (status) {
      case 'preparing': return 'Preparing export...';
      case 'rendering': return 'Rendering video with audio...';
      case 'completed': return 'Export completed!';
      case 'error': return 'Export failed';
      default: return 'Processing...';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'preparing': return 'text-blue-500';
      case 'rendering': return 'text-yellow-500';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  return (
    <>
      {/* Hidden canvas for rendering */}
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
            </div>

            {/* Progress Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${getStatusColor()}`}>
                  {getStatusText()}
                </span>
                {status === 'completed' && (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                )}
              </div>
              
              <Progress value={progress} className="w-full" />
              
              <div className="text-xs text-muted-foreground text-center">
                {progress.toFixed(1)}% completed
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              {status === 'completed' && exportedVideoUrl && (
                <Button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = exportedVideoUrl;
                    link.download = `exported-video-${aspectRatio}-${Date.now()}.webm`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  variant="outline"
                  size="sm"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Again
                </Button>
              )}
              
              <Button
                onClick={handleClose}
                variant={status === 'completed' ? 'default' : 'outline'}
                size="sm"
                disabled={status === 'preparing' || status === 'rendering'}
              >
                {status === 'completed' ? 'Done' : 'Cancel'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

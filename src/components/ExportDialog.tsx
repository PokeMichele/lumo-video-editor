import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle, X, AlertCircle, Cpu } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  totalDuration: number;
  aspectRatio: '16:9' | '4:3' | '9:16';
  selectedFPS: 24 | 30 | 60;
  trackVolumes: Map<string, number>;
}

interface MediaCache {
  videos: Map<string, HTMLVideoElement>;
  audios: Map<string, HTMLAudioElement>;
  images: Map<string, HTMLImageElement>;
}

interface ExportStats {
  framesRendered: number;
  framesTotal: number;
  startTime: number;
  avgFrameTime: number;
  estimatedTimeLeft: string;
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
  const [status, setStatus] = useState<'preparing' | 'loading' | 'rendering' | 'encoding' | 'completed' | 'error'>('preparing');
  const [exportStats, setExportStats] = useState<ExportStats>({
    framesRendered: 0,
    framesTotal: 0,
    startTime: 0,
    avgFrameTime: 0,
    estimatedTimeLeft: ''
  });
  const [qualityMode, setQualityMode] = useState<'standard' | 'high'>('standard');
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef<boolean>(false);
  const renderingRef = useRef<boolean>(false);
  const mediaCacheRef = useRef<MediaCache>({
    videos: new Map(),
    audios: new Map(),
    images: new Map()
  });
  const audioNodesRef = useRef<Map<string, { element: HTMLAudioElement | HTMLVideoElement; gainNode: GainNode; source: MediaElementAudioSourceNode }>>(new Map());

  // Calculate dimensions based on quality and aspect ratio
  const getCanvasDimensions = useCallback(() => {
    const baseWidth = qualityMode === 'high' ? 1920 : 1280;
    
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
  }, [aspectRatio, qualityMode]);

  // Preload all media elements
  const preloadMedia = useCallback(async () => {
    if (cancelledRef.current) return;
    
    setStatus('loading');
    const cache = mediaCacheRef.current;
    
    // Filter unique media items
    const mediaItems = timelineItems.filter(item => 
      item.mediaFile.type !== 'effect'
    );
    
    const loadPromises = mediaItems.map(async (item, index) => {
      if (cancelledRef.current) return;
      
      try {
        if (item.mediaFile.type === 'video' && !cache.videos.has(item.id)) {
          const video = document.createElement('video');
          video.src = item.mediaFile.url;
          video.crossOrigin = 'anonymous';
          video.muted = false;
          video.preload = 'auto';
          video.playsInline = true;
          
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Video load timeout: ${item.mediaFile.name}`));
            }, 10000);
            
            const handleLoad = () => {
              clearTimeout(timeout);
              video.removeEventListener('loadeddata', handleLoad);
              video.removeEventListener('error', handleError);
              
              // Set volume
              const itemVolume = trackVolumes.get(item.id) ?? 100;
              video.volume = Math.max(0, Math.min(1, itemVolume / 100));
              
              cache.videos.set(item.id, video);
              resolve();
            };
            
            const handleError = (e: any) => {
              clearTimeout(timeout);
              video.removeEventListener('loadeddata', handleLoad);
              video.removeEventListener('error', handleError);
              reject(new Error(`Failed to load video: ${item.mediaFile.name}`));
            };
            
            video.addEventListener('loadeddata', handleLoad);
            video.addEventListener('error', handleError);
          });
        }
        
        if (item.mediaFile.type === 'audio' && !cache.audios.has(item.id)) {
          const audio = document.createElement('audio');
          audio.src = item.mediaFile.url;
          audio.crossOrigin = 'anonymous';
          audio.preload = 'auto';
          
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Audio load timeout: ${item.mediaFile.name}`));
            }, 8000);
            
            const handleLoad = () => {
              clearTimeout(timeout);
              audio.removeEventListener('loadeddata', handleLoad);
              audio.removeEventListener('error', handleError);
              
              // Set volume
              const itemVolume = trackVolumes.get(item.id) ?? 100;
              audio.volume = Math.max(0, Math.min(1, itemVolume / 100));
              
              cache.audios.set(item.id, audio);
              resolve();
            };
            
            const handleError = (e: any) => {
              clearTimeout(timeout);
              audio.removeEventListener('loadeddata', handleLoad);
              audio.removeEventListener('error', handleError);
              reject(new Error(`Failed to load audio: ${item.mediaFile.name}`));
            };
            
            audio.addEventListener('loadeddata', handleLoad);
            audio.addEventListener('error', handleError);
          });
        }
        
        if (item.mediaFile.type === 'image' && !cache.images.has(item.id)) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Image load timeout: ${item.mediaFile.name}`));
            }, 5000);
            
            img.onload = () => {
              clearTimeout(timeout);
              cache.images.set(item.id, img);
              resolve();
            };
            
            img.onerror = () => {
              clearTimeout(timeout);
              reject(new Error(`Failed to load image: ${item.mediaFile.name}`));
            };
            
            img.src = item.mediaFile.url;
          });
        }
        
        // Update loading progress
        const loadProgress = ((index + 1) / mediaItems.length) * 100;
        setProgress(loadProgress);
        
      } catch (error) {
        console.warn(`Failed to load media ${item.id}:`, error);
      }
    });
    
    await Promise.all(loadPromises);
  }, [timelineItems, trackVolumes]);

  // Setup audio context with all audio elements
  const setupAudioContext = useCallback(async () => {
    if (cancelledRef.current) return null;
    
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000
      });
      
      const destination = audioContext.createMediaStreamDestination();
      const masterGain = audioContext.createGain();
      masterGain.gain.value = 1.0;
      masterGain.connect(destination);
      
      // Setup audio nodes for all audio and video elements
      const cache = mediaCacheRef.current;
      const audioNodes = audioNodesRef.current;
      
      // Setup video audio
      cache.videos.forEach((video, id) => {
        try {
          const source = audioContext.createMediaElementSource(video);
          const gainNode = audioContext.createGain();
          const itemVolume = trackVolumes.get(id) ?? 100;
          gainNode.gain.value = itemVolume / 100;
          
          source.connect(gainNode);
          gainNode.connect(masterGain);
          
          audioNodes.set(id, { element: video, gainNode, source });
        } catch (error) {
          console.warn(`Failed to setup video audio for ${id}:`, error);
        }
      });
      
      // Setup audio elements
      cache.audios.forEach((audio, id) => {
        try {
          const source = audioContext.createMediaElementSource(audio);
          const gainNode = audioContext.createGain();
          const itemVolume = trackVolumes.get(id) ?? 100;
          gainNode.gain.value = itemVolume / 100;
          
          source.connect(gainNode);
          gainNode.connect(masterGain);
          
          audioNodes.set(id, { element: audio, gainNode, source });
        } catch (error) {
          console.warn(`Failed to setup audio for ${id}:`, error);
        }
      });
      
      audioContextRef.current = audioContext;
      return { audioContext, destination };
      
    } catch (error) {
      console.error('Failed to setup audio context:', error);
      return null;
    }
  }, [trackVolumes]);

  // Effect calculation functions
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
      const progress = relativeTime / effect.duration;

      switch (effect.mediaFile.effectType) {
        case 'fade-in':
          globalAlpha *= Math.min(progress, 1);
          break;
        case 'fade-out':
          globalAlpha *= Math.max(1 - progress, 0);
          break;
      }
    });

    return Math.max(0, Math.min(1, globalAlpha));
  }, [timelineItems]);

  const isBlackWhiteActive = useCallback((time: number) => {
    return timelineItems.some(item =>
      item.mediaFile.type === 'effect' &&
      item.mediaFile.effectType === 'black-white' &&
      time >= item.startTime &&
      time < item.startTime + item.duration
    );
  }, [timelineItems]);

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
      const progress = relativeTime / effect.duration;
      const effectIntensity = effect.mediaFile.effectIntensity || 50;
      const currentBlur = (effectIntensity / 100) * 10;
      blurIntensity = Math.max(blurIntensity, currentBlur);
    });

    return Math.max(0, Math.min(10, blurIntensity));
  }, [timelineItems]);

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
      const progress = relativeTime / effect.duration;
      const effectIntensity = effect.mediaFile.effectIntensity || 50;

      if (effect.mediaFile.effectType === 'zoom-in') {
        const maxZoomFactor = 1 + (effectIntensity / 100) * 2;
        const currentScale = 1 + (progress * (maxZoomFactor - 1));
        zoomScale *= currentScale;
      } else if (effect.mediaFile.effectType === 'zoom-out') {
        const minZoomFactor = 1 - (effectIntensity / 100) * 0.8;
        const currentScale = 1 - (progress * (1 - minZoomFactor));
        zoomScale *= currentScale;
      }
    });

    return Math.max(0.1, Math.min(5.0, zoomScale));
  }, [timelineItems]);

  // Render single frame
  const renderFrame = useCallback(async (time: number, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    if (cancelledRef.current) return;
    
    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get active items
    const activeItems = timelineItems.filter(item =>
      item.mediaFile.type !== 'effect' &&
      time >= item.startTime && 
      time < item.startTime + item.duration
    ).sort((a, b) => a.track - b.track);

    if (activeItems.length === 0) return;

    // Calculate effects
    const globalAlpha = calculateGlobalAlpha(time);
    const blackWhite = isBlackWhiteActive(time);
    const zoomScale = calculateZoomScale(time);
    const blurIntensity = calculateBlurIntensity(time);

    // Apply effects
    ctx.save();
    ctx.globalAlpha = globalAlpha;

    // Build filter string
    const filters = [];
    if (blackWhite) filters.push('grayscale(1)');
    if (blurIntensity > 0) filters.push(`blur(${blurIntensity}px)`);
    ctx.filter = filters.length > 0 ? filters.join(' ') : 'none';

    // Apply zoom
    if (zoomScale !== 1.0) {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      ctx.translate(centerX, centerY);
      ctx.scale(zoomScale, zoomScale);
      ctx.translate(-centerX, -centerY);
    }

    // Render items
    const cache = mediaCacheRef.current;
    
    for (const item of activeItems) {
      if (cancelledRef.current) break;

      try {
        if (item.mediaFile.type === 'video') {
          const video = cache.videos.get(item.id);
          if (!video) continue;

          const relativeTime = time - item.startTime;
          const mediaOffset = item.mediaStartOffset || 0;
          const targetTime = relativeTime + mediaOffset;

          if (Math.abs(video.currentTime - targetTime) > 0.1) {
            video.currentTime = Math.max(0, targetTime);
          }

          if (video.readyState >= 2) {
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

            ctx.drawImage(video, offsetX, offsetY, renderWidth, renderHeight);
          }
        }

        if (item.mediaFile.type === 'image') {
          const img = cache.images.get(item.id);
          if (!img || !img.complete) continue;

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

          const trackOffsetX = item.track * 10;
          const trackOffsetY = item.track * 10;

          ctx.drawImage(
            img,
            offsetX + trackOffsetX,
            offsetY + trackOffsetY,
            renderWidth - trackOffsetX,
            renderHeight - trackOffsetY
          );
        }
      } catch (error) {
        console.warn(`Error rendering item ${item.id}:`, error);
      }
    }

    ctx.restore();
  }, [timelineItems, calculateGlobalAlpha, isBlackWhiteActive, calculateZoomScale, calculateBlurIntensity]);

  // Sync audio elements
  const syncAudio = useCallback((time: number) => {
    if (cancelledRef.current) return;

    const activeItems = timelineItems.filter(item =>
      (item.mediaFile.type === 'audio' || item.mediaFile.type === 'video') &&
      time >= item.startTime && 
      time < item.startTime + item.duration
    );

    const cache = mediaCacheRef.current;
    const audioNodes = audioNodesRef.current;

    // Update active audio
    activeItems.forEach(item => {
      const element = item.mediaFile.type === 'video' 
        ? cache.videos.get(item.id)
        : cache.audios.get(item.id);
      
      const audioNode = audioNodes.get(item.id);
      
      if (element && audioNode) {
        const relativeTime = time - item.startTime;
        const mediaOffset = item.mediaStartOffset || 0;
        const targetTime = relativeTime + mediaOffset;

        if (targetTime >= 0 && targetTime <= element.duration) {
          if (Math.abs(element.currentTime - targetTime) > 0.1) {
            element.currentTime = Math.max(0, targetTime);
          }
          
          if (element.paused) {
            element.play().catch(() => {});
          }
          
          // Apply volume with fade effects
          const globalAlpha = calculateGlobalAlpha(time);
          const itemVolume = trackVolumes.get(item.id) ?? 100;
          audioNode.gainNode.gain.value = (itemVolume / 100) * globalAlpha;
        } else {
          element.pause();
          audioNode.gainNode.gain.value = 0;
        }
      }
    });

    // Pause inactive audio
    cache.videos.forEach((video, id) => {
      if (!activeItems.some(item => item.id === id)) {
        video.pause();
        const audioNode = audioNodes.get(id);
        if (audioNode) audioNode.gainNode.gain.value = 0;
      }
    });

    cache.audios.forEach((audio, id) => {
      if (!activeItems.some(item => item.id === id)) {
        audio.pause();
        const audioNode = audioNodes.get(id);
        if (audioNode) audioNode.gainNode.gain.value = 0;
      }
    });
  }, [timelineItems, calculateGlobalAlpha, trackVolumes]);

  // Main export function
  const exportVideo = useCallback(async () => {
    try {
      if (cancelledRef.current || renderingRef.current) return;

      renderingRef.current = true;
      setStatus('preparing');
      setProgress(0);

      // Preload media
      await preloadMedia();
      if (cancelledRef.current) return;

      // Setup canvas
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas not available');

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      const dimensions = getCanvasDimensions();
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;

      // Calculate export parameters
      const maxEndTime = Math.max(...timelineItems.map(item => item.startTime + item.duration), 1);
      const exportDuration = maxEndTime;
      const totalFrames = Math.ceil(exportDuration * selectedFPS);

      setExportStats({
        framesRendered: 0,
        framesTotal: totalFrames,
        startTime: performance.now(),
        avgFrameTime: 0,
        estimatedTimeLeft: ''
      });

      // Setup audio
      const audioSetup = await setupAudioContext();
      if (cancelledRef.current) return;

      setStatus('rendering');

      // Setup MediaRecorder
      const canvasStream = canvas.captureStream(selectedFPS);
      const audioStream = audioSetup?.destination?.stream;
      
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...(audioStream?.getAudioTracks() || [])
      ]);

      const bitrates = {
        'standard': { video: 5000000, audio: 128000 },
        'high': { video: 10000000, audio: 192000 }
      };

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: bitrates[qualityMode].video,
        audioBitsPerSecond: bitrates[qualityMode].audio
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
          setStatus('encoding');
          
          setTimeout(() => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);

            // Auto-download
            const link = document.createElement('a');
            link.href = url;
            link.download = `video-export-${aspectRatio}-${qualityMode}-${Date.now()}.webm`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setStatus('completed');
            
            setTimeout(() => {
              URL.revokeObjectURL(url);
              onClose();
            }, 2000);
          }, 500);
        }
      };

      mediaRecorder.start();

      // Rendering loop
      let currentFrame = 0;
      const startTime = performance.now();

      const renderLoop = async () => {
        if (cancelledRef.current || currentFrame >= totalFrames) {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          return;
        }

        const currentTime = currentFrame / selectedFPS;

        // Sync audio
        syncAudio(currentTime);

        // Render frame
        await renderFrame(currentTime, ctx, canvas);

        currentFrame++;
        const progressPercent = (currentFrame / totalFrames) * 100;
        setProgress(progressPercent);

        // Update stats
        const elapsed = performance.now() - startTime;
        const avgFrameTime = elapsed / currentFrame;
        const remainingFrames = totalFrames - currentFrame;
        const estimatedTimeLeft = (remainingFrames * avgFrameTime) / 1000;
        
        setExportStats(prev => ({
          ...prev,
          framesRendered: currentFrame,
          avgFrameTime,
          estimatedTimeLeft: `${Math.floor(estimatedTimeLeft / 60)}:${String(Math.floor(estimatedTimeLeft % 60)).padStart(2, '0')}`
        }));

        // Schedule next frame
        setTimeout(renderLoop, Math.max(1, 1000 / selectedFPS - 5));
      };

      renderLoop();

    } catch (error) {
      console.error('Export failed:', error);
      if (!cancelledRef.current) {
        renderingRef.current = false;
        setStatus('error');
      }
    }
  }, [timelineItems, aspectRatio, qualityMode, selectedFPS, getCanvasDimensions, preloadMedia, setupAudioContext, renderFrame, syncAudio]);

  // Cleanup resources
  const cleanupResources = useCallback(() => {
    cancelledRef.current = true;
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (error) {
        console.warn('Error stopping MediaRecorder:', error);
      }
    }
    
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (error) {
        console.warn('Error closing audio context:', error);
      }
      audioContextRef.current = null;
    }
    
    // Cleanup media cache
    const cache = mediaCacheRef.current;
    cache.videos.forEach(video => {
      video.pause();
      video.src = '';
    });
    cache.videos.clear();
    
    cache.audios.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    cache.audios.clear();
    
    cache.images.clear();
    audioNodesRef.current.clear();
    recordedChunksRef.current = [];
    renderingRef.current = false;
  }, []);

  // Dialog management
  useEffect(() => {
    if (!isOpen) {
      cleanupResources();
      setProgress(0);
      setStatus('preparing');
      return;
    }

    cancelledRef.current = false;
    renderingRef.current = false;
    setProgress(0);
    setStatus('preparing');

    const startExport = setTimeout(() => {
      if (!cancelledRef.current && !renderingRef.current) {
        exportVideo();
      }
    }, 1000);

    return () => {
      clearTimeout(startExport);
    };
  }, [isOpen, exportVideo, cleanupResources]);

  // Event handlers
  const handleCancel = useCallback(() => {
    cleanupResources();
    setProgress(0);
    setStatus('preparing');
  }, [cleanupResources]);

  const handleClose = useCallback(() => {
    if (status === 'preparing' || status === 'rendering' || status === 'loading') {
      handleCancel();
    } else {
      cleanupResources();
    }
    onClose();
  }, [status, handleCancel, cleanupResources, onClose]);

  const handleQualityChange = useCallback((newQuality: 'standard' | 'high') => {
    if (status === 'preparing') {
      setQualityMode(newQuality);
    }
  }, [status]);

  // UI helpers
  const getStatusText = () => {
    if (cancelledRef.current) return 'Export cancelled';
    
    switch (status) {
      case 'preparing': return 'Preparing export...';
      case 'loading': return 'Loading media files...';
      case 'rendering': return `Rendering frames (${exportStats.framesRendered}/${exportStats.framesTotal})`;
      case 'encoding': return 'Finalizing video...';
      case 'completed': return 'Export completed successfully!';
      case 'error': return 'Export failed';
      default: return 'Processing...';
    }
  };

  const getStatusColor = () => {
    if (cancelledRef.current) return 'text-orange-500';
    
    switch (status) {
      case 'preparing': return 'text-blue-500';
      case 'loading': return 'text-blue-500';
      case 'rendering': return 'text-yellow-500';
      case 'encoding': return 'text-purple-500';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    if (cancelledRef.current) return <AlertCircle className="w-5 h-5 text-orange-500" />;
    
    switch (status) {
      case 'rendering': return <Cpu className="w-5 h-5 text-yellow-500 animate-pulse" />;
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error': return <X className="w-5 h-5 text-red-500" />;
      default: return null;
    }
  };

  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Export Video
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Quality Selection */}
            {status === 'preparing' && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Export Quality</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['standard', 'high'] as const).map((quality) => (
                    <Button
                      key={quality}
                      variant={qualityMode === quality ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleQualityChange(quality)}
                    >
                      {quality.charAt(0).toUpperCase() + quality.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Export Details */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Quality:</span>
                <span className="font-medium">{qualityMode}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Aspect Ratio:</span>
                <span className="font-medium">{aspectRatio}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Frame Rate:</span>
                <span className="font-medium">{selectedFPS} fps</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Duration:</span>
                <span className="font-medium">{Math.round(totalDuration)}s</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Frames:</span>
                <span className="font-medium">{exportStats.framesTotal}</span>
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
                {status === 'rendering' && exportStats.estimatedTimeLeft && (
                  <span>Est. {exportStats.estimatedTimeLeft} remaining</span>
                )}
              </div>
            </div>

            {/* Rendering Stats */}
            {status === 'rendering' && exportStats.avgFrameTime > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Avg frame time: {exportStats.avgFrameTime.toFixed(1)}ms</div>
                <div>Rendering speed: {(1000 / exportStats.avgFrameTime).toFixed(1)} fps</div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              <Button
                onClick={handleClose}
                variant={status === 'completed' ? 'default' : 'outline'}
                size="sm"
              >
                {status === 'preparing' || status === 'loading' || status === 'rendering' ? 'Cancel' : 'Close'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";

interface VideoPlayerProps {
  timelineItems: TimelineItem[];
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onPlayStateChange: (playing: boolean) => void;
}

// Cache globale per video preloadati
const videoCache = new Map<string, HTMLVideoElement>();
const audioCache = new Map<string, HTMLAudioElement>();

// Debounce utility
const useDebounce = (value: any, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  
  return debouncedValue;
};

export const VideoPlayer = ({ 
  timelineItems, 
  currentTime, 
  isPlaying, 
  onTimeUpdate, 
  onPlayStateChange 
}: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationFrameRef = useRef<number>();
  const lastSeekTimeRef = useRef<number>(0);
  const isSeekingRef = useRef<boolean>(false);
  const currentVideoItemIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<Map<string, { element: HTMLAudioElement; gainNode: GainNode; source?: MediaElementAudioSourceNode }>>(new Map());
  
  const [volume, setVolume] = useState(100);
  const [isBuffering, setIsBuffering] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  // Debounce seek operations to prevent excessive updates
  const debouncedCurrentTime = useDebounce(currentTime, 50);

  // Memoize active items calculation
  const activeItems = useMemo(() => {
    return timelineItems
      .filter(item => 
        currentTime >= item.startTime && 
        currentTime < item.startTime + item.duration
      )
      .sort((a, b) => a.track - b.track);
  }, [timelineItems, Math.floor(currentTime * 10) / 10]); // Round to prevent excessive recalculation

  // Current video item
  const currentVideoItem = useMemo(() => {
    return activeItems.find(item => item.mediaFile.type === 'video') || null;
  }, [activeItems]);

  // Current audio items
  const currentAudioItems = useMemo(() => {
    return activeItems.filter(item => item.mediaFile.type === 'audio');
  }, [activeItems]);

  // Initialize audio context
  useEffect(() => {
    const initAudioContext = async () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }
      } catch (error) {
        console.warn('Failed to initialize audio context:', error);
      }
    };

    initAudioContext();
    
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Preload strategy for better performance
  const preloadMedia = useCallback(async (items: TimelineItem[]) => {
    const videoItems = items.filter(item => item.mediaFile.type === 'video');
    const audioItems = items.filter(item => item.mediaFile.type === 'audio');

    // Preload videos in parallel with limit
    const videoPromises = videoItems.slice(0, 3).map(async (item) => {
      if (!videoCache.has(item.id)) {
        return new Promise<void>((resolve) => {
          const video = document.createElement('video');
          video.src = item.mediaFile.url;
          video.crossOrigin = 'anonymous';
          video.preload = 'metadata';
          video.muted = true; // Muted for autoplay policy
          video.playsInline = true;
          
          const handleLoad = () => {
            videoCache.set(item.id, video);
            video.removeEventListener('loadedmetadata', handleLoad);
            video.removeEventListener('error', handleError);
            resolve();
          };
          
          const handleError = () => {
            console.warn(`Failed to preload video: ${item.mediaFile.name}`);
            video.removeEventListener('loadedmetadata', handleLoad);
            video.removeEventListener('error', handleError);
            resolve();
          };
          
          video.addEventListener('loadedmetadata', handleLoad);
          video.addEventListener('error', handleError);
          
          // Timeout fallback
          setTimeout(() => {
            video.removeEventListener('loadedmetadata', handleLoad);
            video.removeEventListener('error', handleError);
            resolve();
          }, 3000);
        });
      }
      return Promise.resolve();
    });

    // Preload audio in parallel
    const audioPromises = audioItems.slice(0, 5).map(async (item) => {
      if (!audioCache.has(item.id)) {
        return new Promise<void>((resolve) => {
          const audio = document.createElement('audio');
          audio.src = item.mediaFile.url;
          audio.crossOrigin = 'anonymous';
          audio.preload = 'metadata';
          
          const handleLoad = () => {
            audioCache.set(item.id, audio);
            audio.removeEventListener('loadedmetadata', handleLoad);
            audio.removeEventListener('error', handleError);
            resolve();
          };
          
          const handleError = () => {
            console.warn(`Failed to preload audio: ${item.mediaFile.name}`);
            audio.removeEventListener('loadedmetadata', handleLoad);
            audio.removeEventListener('error', handleError);
            resolve();
          };
          
          audio.addEventListener('loadedmetadata', handleLoad);
          audio.addEventListener('error', handleError);
          
          setTimeout(() => {
            audio.removeEventListener('loadedmetadata', handleLoad);
            audio.removeEventListener('error', handleError);
            resolve();
          }, 3000);
        });
      }
      return Promise.resolve();
    });

    await Promise.all([...videoPromises, ...audioPromises]);
  }, []);

  // Enhanced video switching with smooth transitions
  const switchVideo = useCallback(async (newVideoItem: TimelineItem | null) => {
    if (!videoRef.current) return;
    
    const video = videoRef.current;
    
    if (!newVideoItem) {
      video.src = '';
      video.pause();
      currentVideoItemIdRef.current = null;
      return;
    }

    if (currentVideoItemIdRef.current === newVideoItem.id) return;
    
    setIsBuffering(true);
    
    try {
      // Use cached video if available
      const cachedVideo = videoCache.get(newVideoItem.id);
      
      if (cachedVideo) {
        // Copy from cache to main video element
        video.src = cachedVideo.src;
        video.currentTime = cachedVideo.currentTime;
      } else {
        video.src = newVideoItem.mediaFile.url;
      }
      
      currentVideoItemIdRef.current = newVideoItem.id;
      
      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          video.removeEventListener('loadeddata', handleLoad);
          video.removeEventListener('error', handleError);
          reject(new Error('Video load timeout'));
        }, 5000);
        
        const handleLoad = () => {
          clearTimeout(timeout);
          video.removeEventListener('loadeddata', handleLoad);
          video.removeEventListener('error', handleError);
          resolve();
        };
        
        const handleError = () => {
          clearTimeout(timeout);
          video.removeEventListener('loadeddata', handleLoad);
          video.removeEventListener('error', handleError);
          reject(new Error('Video load failed'));
        };
        
        if (video.readyState >= 2) {
          resolve();
        } else {
          video.addEventListener('loadeddata', handleLoad);
          video.addEventListener('error', handleError);
        }
      });
      
    } catch (error) {
      console.warn('Failed to switch video:', error);
    } finally {
      setIsBuffering(false);
    }
  }, []);

  // Enhanced audio management with Web Audio API
  const setupAudioNode = useCallback(async (item: TimelineItem) => {
    if (!audioContextRef.current || audioNodesRef.current.has(item.id)) return;
    
    try {
      let audioElement = audioCache.get(item.id);
      
      if (!audioElement) {
        audioElement = document.createElement('audio');
        audioElement.src = item.mediaFile.url;
        audioElement.crossOrigin = 'anonymous';
        audioElement.preload = 'metadata';
        audioCache.set(item.id, audioElement);
      }
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          audioElement!.removeEventListener('loadedmetadata', handleLoad);
          audioElement!.removeEventListener('error', handleError);
          reject(new Error('Audio load timeout'));
        }, 3000);
        
        const handleLoad = () => {
          clearTimeout(timeout);
          audioElement!.removeEventListener('loadedmetadata', handleLoad);
          audioElement!.removeEventListener('error', handleError);
          resolve();
        };
        
        const handleError = () => {
          clearTimeout(timeout);
          audioElement!.removeEventListener('loadedmetadata', handleLoad);
          audioElement!.removeEventListener('error', handleError);
          reject(new Error('Audio load failed'));
        };
        
        if (audioElement!.readyState >= 1) {
          resolve();
        } else {
          audioElement!.addEventListener('loadedmetadata', handleLoad);
          audioElement!.addEventListener('error', handleError);
        }
      });
      
      // Create audio nodes
      const source = audioContextRef.current.createMediaElementSource(audioElement);
      const gainNode = audioContextRef.current.createGain();
      
      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);
      
      audioNodesRef.current.set(item.id, {
        element: audioElement,
        gainNode,
        source
      });
      
    } catch (error) {
      console.warn(`Failed to setup audio node for ${item.id}:`, error);
    }
  }, []);

  // Smooth seeking with requestAnimationFrame
  const performSeek = useCallback((targetTime: number) => {
    if (isSeekingRef.current) return;
    
    isSeekingRef.current = true;
    lastSeekTimeRef.current = targetTime;
    
    const seekOperation = () => {
      const video = videoRef.current;
      if (!video || !currentVideoItem) {
        isSeekingRef.current = false;
        return;
      }
      
      const relativeTime = targetTime - currentVideoItem.startTime;
      const mediaOffset = currentVideoItem.mediaStartOffset || 0;
      const finalTime = Math.max(0, relativeTime + mediaOffset);
      
      // Only seek if significant difference
      if (Math.abs(video.currentTime - finalTime) > 0.1) {
        video.currentTime = finalTime;
      }
      
      // Sync audio
      currentAudioItems.forEach(audioItem => {
        const audioNode = audioNodesRef.current.get(audioItem.id);
        if (audioNode) {
          const audioRelativeTime = targetTime - audioItem.startTime;
          const audioOffset = audioItem.mediaStartOffset || 0;
          const audioFinalTime = Math.max(0, audioRelativeTime + audioOffset);
          
          if (Math.abs(audioNode.element.currentTime - audioFinalTime) > 0.1) {
            audioNode.element.currentTime = audioFinalTime;
          }
        }
      });
      
      isSeekingRef.current = false;
    };
    
    requestAnimationFrame(seekOperation);
  }, [currentVideoItem, currentAudioItems]);

  // Optimized time sync with RAF
  const syncPlayback = useCallback(() => {
    if (!isPlaying) return;
    
    const video = videoRef.current;
    if (video && currentVideoItem && !isSeekingRef.current) {
      const videoRelativeTime = video.currentTime - (currentVideoItem.mediaStartOffset || 0);
      const globalTime = currentVideoItem.startTime + videoRelativeTime;
      
      // Only update if significant change
      if (Math.abs(globalTime - currentTime) > 0.05) {
        onTimeUpdate(globalTime);
      }
    }
    
    animationFrameRef.current = requestAnimationFrame(syncPlayback);
  }, [isPlaying, currentVideoItem, currentTime, onTimeUpdate]);

  // Effect for video switching
  useEffect(() => {
    switchVideo(currentVideoItem);
  }, [currentVideoItem, switchVideo]);

  // Effect for seeking
  useEffect(() => {
    if (!isPlaying) {
      performSeek(debouncedCurrentTime);
    }
  }, [debouncedCurrentTime, performSeek, isPlaying]);

  // Effect for play/pause
  useEffect(() => {
    const video = videoRef.current;
    
    if (isPlaying) {
      // Start video
      if (video && currentVideoItem) {
        video.play().catch(console.warn);
      }
      
      // Start audio
      currentAudioItems.forEach(async (audioItem) => {
        await setupAudioNode(audioItem);
        const audioNode = audioNodesRef.current.get(audioItem.id);
        if (audioNode) {
          audioNode.element.play().catch(console.warn);
        }
      });
      
      // Start sync loop
      syncPlayback();
    } else {
      // Pause video
      if (video) {
        video.pause();
      }
      
      // Pause audio
      audioNodesRef.current.forEach(({ element }) => {
        element.pause();
      });
      
      // Stop sync loop
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, currentVideoItem, currentAudioItems, setupAudioNode, syncPlayback]);

  // Preload nearby items
  useEffect(() => {
    const nearbyItems = timelineItems.filter(item => {
      const itemEnd = item.startTime + item.duration;
      const buffer = 5; // 5 second buffer
      return (
        (item.startTime <= currentTime + buffer && itemEnd >= currentTime - buffer) ||
        (item.mediaFile.type === 'video' || item.mediaFile.type === 'audio')
      );
    });
    
    preloadMedia(nearbyItems);
  }, [timelineItems, currentTime, preloadMedia]);

  // Volume control
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume / 100;
    }
    
    audioNodesRef.current.forEach(({ gainNode }) => {
      gainNode.gain.value = volume / 100;
    });
  }, [volume]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Cleanup audio nodes
      audioNodesRef.current.forEach(({ element }) => {
        element.pause();
      });
      audioNodesRef.current.clear();
    };
  }, []);

  // Event handlers
  const handlePlayPause = useCallback(() => {
    onPlayStateChange(!isPlaying);
  }, [isPlaying, onPlayStateChange]);

  const handleSeekBackward = useCallback(() => {
    onTimeUpdate(Math.max(0, currentTime - 5));
  }, [currentTime, onTimeUpdate]);

  const handleSeekForward = useCallback(() => {
    onTimeUpdate(currentTime + 5);
  }, [currentTime, onTimeUpdate]);

  const handleVolumeChange = useCallback((value: number[]) => {
    setVolume(value[0]);
  }, []);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Progress tracking for video loading
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateProgress = () => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const duration = video.duration || 0;
        if (duration > 0) {
          setLoadProgress((bufferedEnd / duration) * 100);
        }
      }
    };

    video.addEventListener('progress', updateProgress);
    return () => video.removeEventListener('progress', updateProgress);
  }, [currentVideoItem]);

  return (
    <div className="h-full flex flex-col">
      {/* Video Display Area */}
      <div className="flex-1 flex items-center justify-center bg-black/50 relative">
        {currentVideoItem ? (
          <>
            <video
              ref={videoRef}
              className="max-w-full max-h-full object-contain"
              playsInline
              muted={false}
            />
            
            {/* Loading indicator */}
            {isBuffering && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="flex items-center space-x-2 text-white">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  <span>Loading...</span>
                </div>
              </div>
            )}
            
            {/* Buffer progress */}
            {loadProgress < 100 && loadProgress > 0 && (
              <div className="absolute bottom-2 left-2 right-2 h-1 bg-white/20 rounded">
                <div 
                  className="h-full bg-white/50 rounded transition-all duration-200"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-muted-foreground">
            <div className="text-6xl mb-4">🎬</div>
            <p className="text-lg">No video selected</p>
            <p className="text-sm">Add video files to timeline to preview</p>
          </div>
        )}
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
              disabled={isBuffering}
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
            {currentVideoItem && (
              <span className="text-xs ml-2 opacity-60">
                / {formatTime(currentVideoItem.startTime + currentVideoItem.duration)}
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
          </div>
        </div>
        
        {/* Audio tracks indicator */}
        {currentAudioItems.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            {currentAudioItems.length} audio track{currentAudioItems.length > 1 ? 's' : ''} playing
          </div>
        )}
      </Card>
    </div>
  );
};
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Volume2, VolumeX, RotateCcw, X, Music, Video } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface AudioMixerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  trackVolumes: Map<string, number>; // itemId -> volume (0-200)
  onVolumeChange: (itemId: string, volume: number) => void;
  onResetVolumes: () => void;
}

export const AudioMixerDialog = ({
  isOpen,
  onClose,
  timelineItems,
  trackVolumes,
  onVolumeChange,
  onResetVolumes
}: AudioMixerDialogProps) => {
  // Stili CSS per nascondere il thumb degli slider
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .audio-mixer-slider .slider-thumb {
        display: none !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
      }
      .audio-mixer-slider [role="slider"] {
        display: none !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
      }
      .audio-mixer-slider .slider-track {
        background: transparent !important;
      }
      .audio-mixer-slider .slider-range {
        display: none !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style);
      }
    };
  }, []);
  // Filtra solo gli elementi che hanno audio
  const audioItems = timelineItems.filter(item => 
    item.mediaFile.type === 'video' || item.mediaFile.type === 'audio'
  );

  const formatVolume = (volume: number) => {
    return `${volume}%`;
  };

  const getSliderColor = (mediaType: string) => {
    return mediaType === 'video' ? 'bg-blue-600' : 'bg-green-600';
  };

  const getTrackColor = (mediaType: string) => {
    return mediaType === 'video' ? 'border-blue-500' : 'border-green-500';
  };

  const getTrackIcon = (mediaType: string) => {
    return mediaType === 'video' ? Video : Music;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="w-5 h-5" />
            Audio Mixer
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0">
          {audioItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center py-12">
              <div>
                <VolumeX className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">No Audio Tracks</h3>
                <p className="text-sm text-muted-foreground/70 max-w-md">
                  Add audio or video files to the timeline to control their individual volumes
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Controls Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-medium">Audio Tracks</h3>
                  <p className="text-sm text-muted-foreground">
                    {audioItems.length} track{audioItems.length !== 1 ? 's' : ''} with audio • Individual volume control
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-blue-600 rounded"></div>
                        <span>Video Audio</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 bg-green-600 rounded"></div>
                        <span>Pure Audio</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onResetVolumes}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset All to 100%
                  </Button>
                </div>
              </div>

              {/* Audio Sliders */}
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-4 pb-4">
                  {audioItems.map((item) => {
                    const currentVolume = trackVolumes.get(item.id) ?? 100;
                    const isMuted = currentVolume === 0;
                    const isOveramplified = currentVolume > 100;
                    const IconComponent = getTrackIcon(item.mediaFile.type);

                    return (
                      <div
                        key={item.id}
                        className={`flex flex-col items-center p-4 border-2 rounded-lg ${getTrackColor(item.mediaFile.type)} bg-card hover:shadow-md transition-shadow`}
                      >
                        {/* Track Info */}
                        <div className="text-center mb-4 w-full">
                          <div className="flex items-center justify-center gap-2 mb-2">
                            <IconComponent className={`w-4 h-4 ${item.mediaFile.type === 'video' ? 'text-blue-500' : 'text-green-500'}`} />
                            <span className={`text-xs px-2 py-1 rounded-full ${item.mediaFile.type === 'video' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                              {item.mediaFile.type === 'video' ? 'Video' : 'Audio'}
                            </span>
                          </div>
                          <h4 className="font-medium text-sm truncate w-full" title={item.mediaFile.name}>
                            {item.mediaFile.name}
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            {item.duration.toFixed(1)}s • Track {item.track + 1}
                          </p>
                        </div>

                        {/* Volume Slider */}
                        <div className="flex flex-col items-center flex-1 w-full">
                          {/* Volume Display */}
                          <div className="mb-3 text-center">
                            <span className={`text-xl font-bold ${
                              isMuted ? 'text-red-500' : 
                              isOveramplified ? 'text-orange-500' : 
                              'text-foreground'
                            }`}>
                              {formatVolume(currentVolume)}
                            </span>
                            {isOveramplified && (
                              <div className="text-xs text-orange-600 mt-1">Amplified</div>
                            )}
                            {isMuted && (
                              <div className="text-xs text-red-600 mt-1">Muted</div>
                            )}
                          </div>

                          {/* Vertical Slider Container */}
                          <div className="relative h-48 w-10 bg-muted/50 rounded-full border border-border">
                            {/* Volume Level Indicator */}
                            <div
                              className={`absolute bottom-0 left-0 right-0 rounded-full transition-all duration-300 ${
                                isMuted ? 'bg-red-500' : 
                                isOveramplified ? 'bg-orange-500' :
                                getSliderColor(item.mediaFile.type)
                              }`}
                              style={{
                                height: `${Math.min((currentVolume / 200) * 100, 100)}%`
                              }}
                            />
                            
                            {/* 100% Reference Line */}
                            <div 
                              className="absolute left-0 right-0 border-t-2 border-yellow-400 z-10"
                              style={{ bottom: '50%' }}
                            />
                            
                            {/* Reference markers */}
                            <div className="absolute left-0 right-0 h-full">
                              {/* 0% marker */}
                              <div className="absolute bottom-0 left-0 right-0 border-t border-muted-foreground/30" />
                              {/* 50% marker */}
                              <div className="absolute left-0 right-0 border-t border-muted-foreground/20" style={{ bottom: '25%' }} />
                              {/* 150% marker */}
                              <div className="absolute left-0 right-0 border-t border-muted-foreground/20" style={{ bottom: '75%' }} />
                              {/* 200% marker */}
                              <div className="absolute top-0 left-0 right-0 border-t border-muted-foreground/30" />
                            </div>

                            {/* Slider */}
                            <Slider
                              value={[currentVolume]}
                              onValueChange={(value) => onVolumeChange(item.id, value[0])}
                              max={200}
                              min={0}
                              step={1}
                              orientation="vertical"
                              className="absolute inset-0 h-full z-20 audio-mixer-slider"
                            />
                          </div>

                          {/* Quick Actions */}
                          <div className="flex gap-1 mt-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => onVolumeChange(item.id, isMuted ? 100 : 0)}
                              title={isMuted ? 'Unmute' : 'Mute'}
                            >
                              {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => onVolumeChange(item.id, 100)}
                              title="Reset to 100%"
                            >
                              100
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => onVolumeChange(item.id, 150)}
                              title="Boost to 150%"
                            >
                              150
                            </Button>
                          </div>
                        </div>

                        {/* Volume Scale */}
                        <div className="text-xs text-muted-foreground mt-3 flex justify-between w-full">
                          <span>0%</span>
                          <span className="text-yellow-600 font-medium">100%</span>
                          <span>200%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Info Footer */}
              <div className="mt-4 p-3 bg-muted/30 rounded-lg">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>• <strong>0-100%:</strong> Normal range (100% = original volume)</div>
                  <div>• <strong>100-200%:</strong> Amplification range (may cause distortion)</div>
                  <div>• <strong>Yellow line:</strong> 100% reference (original volume)</div>
                  <div>• <strong>Changes affect:</strong> Timeline playback and final export</div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-4 border-t gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-2" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
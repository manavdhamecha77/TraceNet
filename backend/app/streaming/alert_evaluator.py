from app.streaming.config import StreamConfig

class RealTimeAlertEvaluator:
    def __init__(self, config: StreamConfig):
        self.config = config
        self.reset()
        
    def reset(self):
        self.consecutive_theft = 0
        self.consecutive_assault = 0

    def evaluate(self, detections, frame_idx) -> list[dict]:
        alerts = []
        
        theft_keywords = ('theft', 'snatch', 'stealing', 'robbery', 'thief')
        assault_keywords = ('assault', 'fight', 'violence', 'punch', 'kick', 'attack')
        
        has_theft = False
        has_assault = False
        
        for d in detections:
            cname = d.class_name.lower()
            if any(k in cname for k in theft_keywords):
                has_theft = True
            if any(k in cname for k in assault_keywords):
                has_assault = True

        if has_theft:
            self.consecutive_theft += 1
        else:
            self.consecutive_theft = 0
            
        if has_assault:
            self.consecutive_assault += 1
        else:
            self.consecutive_assault = 0
            
        if self.consecutive_theft >= self.config.theft_consecutive_frames:
            alerts.append({"type": "theft", "frame": frame_idx})
            self.consecutive_theft = 0  # reset after alert
            
        if self.consecutive_assault >= self.config.assault_consecutive_frames:
            alerts.append({"type": "assault", "frame": frame_idx})
            self.consecutive_assault = 0 # reset after alert
            
        return alerts

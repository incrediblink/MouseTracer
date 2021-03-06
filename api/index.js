var express = require('express');
var router = express.Router();
var Redis = require('ioredis');
var preCheck = require('./calculate/preliminaryCheck');
var traceInfo = require('./calculate/traceInfo');
var getDissimilarity = require('./calculate/getDissimilarity');
var checkIP = require('./calculate/checkIP.js');
var getCredibility = require('./calculate/getCredibility');

router.get('/', function(req, res, next) {
    res.render('index', { title: 'Express' });
});

//  HLEN获得字段数量的方式不太安全…… 还是设counter比较好
//  TODO: 把pipeline改成multi以保证安全性
router.post('/verify', function(req, res, next) {
    var callbackSet = preCheck(req.body.traceArray, req.body.width, req.body.height);
    if(!callbackSet){
        res.send("Something wrong.").end();
    } else {
        var euclideanStep = callbackSet[0];
        var traceArray = callbackSet[1];
        var ansOfCalcu = traceInfo(euclideanStep, traceArray);
        if(ansOfCalcu == 0){
            res.send("Something wrong.").end();
        } else {
            var redis = new Redis();
            checkIP(ansOfCalcu, req.ip, redis, function(err, ansOfCheckIP) {
                // console.log("CheckIP: ", ansOfCheckIP);
                redis.get("counter", function(err, counter) {
                    if (err) throw(err);
                    var key = "trace:" + counter;
                    var pipeline = redis.pipeline();
                    pipeline.hset(key, "trace", JSON.stringify(traceArray))
                            .hset(key, "ip", req.ip)
                            .hset(key, "req_headers", JSON.stringify(req.headers))
                            .hset(key, "timestamp", Date.now())
                            .hset(key, "details", JSON.stringify(ansOfCalcu));
                    pipeline.hget("client_ip:" + req.ip, "counter", function(err, value){
                        var pipeline_1 = redis.pipeline();
                        if(!value){
                            // 在ip列表里面登记一下
                            pipeline_1.hget("client_ip_set", "counter", function(err, value){
                                var pipeline_2 = redis.pipeline();
                                pipeline_2.hset("client_ip_set", "ip_id:" + value, req.ip)
                                        .hincrby("client_ip_set", "counter", 1)
                                        .exec();
                            });
                            // 初始化
                            pipeline_1.hset("client_ip:" + req.ip, "counter", 0);
                            value = 0;
                        }
                        pipeline_1.hset("client_ip:" + req.ip, "key:" + value, "trace:" + counter)
                                .hset(key, "ip_key", "key:" + value)
                                .hincrby("client_ip:" + req.ip, "counter", 1)
                                .exec();
                    });
                    pipeline.incr("counter")
                            .exec(function(err, values){
                        var pipeline_3 = redis.pipeline();
                        pipeline_3.llen("credible_trace").llen("credible_trace_to_be_tested").exec(function(err, values){
                            if(values[0][1] != 0 && values[1][1] != 0)
                                getCredibility(ansOfCalcu, redis, function(credibility, dissimilarity){
                                    redis.get("trace_threshold", function(err, threshold){
                                        credibility *= threshold;
                                        res.send(["这是我们的第" + ++counter + "条轨迹</br>该鼠标轨迹的可信值为" + credibility * threshold, key, dissimilarity]).end();
                                    });
                                });
                            else {
                                res.send(["这是我们的第" + ++counter + "条轨迹", key]).end();
                            }
                        })
                        
                    });
                });
            });
        }
    }
});

// router.get('/delete/all/saved/traces', function(req, res, next) {
//     var redis = new Redis();
//     redis.get("counter", function(err, counter) {
//         for(var i = 0; i < counter; i++){
//             redis.del("trace:" + i);
//             console.log("trace:" + i);
//         }
//         redis.del("trace:" + counter);
//         redis.set("counter", 0);
//         redis.del("credible_trace");
//         redis.hget("client_ip_set", "counter", function(err, setCounter){
//             for(var n = 0; n < setCounter; n++){
//                 redis.hget("client_ip_set", "ip_id:" + n, function(err, value){
//                     redis.del("client_ip:" + value);
//                     console.log("ip_id:" + n);
//                 });
//                 redis.hdel("client_ip_set", "ip_id:" + n);
//             }
//             redis.hset("client_ip_set", "counter", 0, function(err,value){
//                 res.send("233").end();
//             });
//         });
//     });
// });         

module.exports = router;